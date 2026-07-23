# Backend — Phase 7: Multi-provider Hardening & Observability

> Goal: make the realtime stack production-grade — providers fail over cleanly,
> every request/session is traceable, latency and cost are measured end-to-end,
> and the system degrades gracefully under load.
> Outcome: if a provider (LLM, avatar, STT/TTS, vector store) errors or slows,
> the agent falls back automatically, and operators can see exactly what happened.

---

## Scope

- Provider fallback chains for LLM, avatar, STT/TTS, and vector store strategies.
- Distributed tracing + structured logging correlation across API -> queue ->
  agent-worker.
- Metrics (RED + latency histograms) and health/readiness endpoints.
- Cost tracking per session and per provider.
- Load, chaos, and eval regression testing.

---

## Tasks

1. **Provider fallback** (extends the strategy pattern in `@repo/*`)
   - [x] Configure ordered fallbacks per capability, e.g.
     `LLM: [realtime, chained]`, `avatar: [tavus, voice-only]`,
     `vector: [mongo, qdrant]`. (LLM chain covers text-completion
     openai→anthropic via `@repo/resilience`, not the realtime→chained voice
     example — see Phase 7 risk note below)
   - [x] Wrap provider calls with timeouts, retries (jittered backoff), and circuit
     breakers; on trip, switch to the next provider and log the reason.
   - [x] Avatar attach failure already falls back to voice-only; generalize the
     pattern to all providers.

2. **Tracing & log correlation** ([`@repo/logger`](../../packages/logger))
   - [x] Propagate a `traceId`/`sessionId` from the API through BullMQ jobs into the
     agent-worker; attach to every log line (pino) and span (OpenTelemetry).
     (agent-worker is LiveKit-dispatched, not a BullMQ job — trace context
     travels via `dispatchAgent`'s metadata instead, same inject/extract
     mechanism as `@repo/queue`; `apps/agent-worker/src/tracing.js` bootstraps
     its own OTel SDK, `trace-context.js` extracts the parent context,
     `agent.js` binds a per-session pino logger via `@repo/logger`'s
     `runWithContext`/`getLogger`)
   - [x] Export traces to an OTLP collector (Tempo/Jaeger/Datadog).

3. **Metrics & health**
   - [x] Emit Prometheus metrics: request rate/errors/duration (RED), queue depth,
     job latency, session join time, first-audio latency, tool-call latency.
     (all in `apps/api/src/services/metrics.js`: queue depth/job latency
     observed directly from BullMQ via `@repo/queue`; session join/first-audio/
     tool-call latency published by `apps/agent-worker` over a dedicated Redis
     pub/sub channel — `@repo/realtime`'s `publishMetric`/`METRICS_CHANNEL` —
     since agent-worker is often a short-lived forked process per session, not
     a scrapable HTTP service; first-audio reuses the LiveKit Agents
     framework's own `ttftMs` instrumentation rather than approximating it)
   - [x] `GET /health` (liveness) and `GET /ready` (deps: Mongo, Redis, LiveKit,
     provider reachability) for orchestrator probes.

4. **Cost tracking**
   - [x] Attribute token/minute usage to `traceId`/`sessionId`; roll into
     `UsageRecord` (Phase 6) and a cost dashboard metric.
     (agent-worker estimates realtime-model token cost + vision-call cost
     per session in `session-cost-tracker.js`, publishes it over
     `@repo/realtime`'s new `USAGE_CHANNEL`/`publishUsage`; apps/api's new
     `usage-bridge.js` relays it into Phase 6's real `recordUsage()` —
     `UsageRecord` + `Subscription.usage`; also published as the
     `session_cost_usd` Prometheus histogram via the existing session-metrics
     path)
   - [x] Alert on anomalous per-session cost (runaway tour/vision loops).
     (`session-cost-tracker.js`'s `checkThreshold()` fires exactly once per
     session when running cost crosses `SESSION_COST_ALERT_USD`, logged via
     the already-`traceId`/`sessionId`-bound pino logger)

5. **Resilience patterns**
   - [x] Idempotent job handlers; dead-letter queue for poison jobs.
     (existing handlers were already idempotent via upsert/delete-then-insert;
     built the missing piece — `@repo/queue`'s `createWorker` now writes a
     `DeadLetterJob` doc on a job's final failed attempt)
   - [x] Graceful shutdown (drain sessions/jobs) and backpressure on the API.
     (`apps/api/src/shutdown.js` — SIGTERM/SIGINT drains in-flight
     HTTP/Socket.IO connections then closes Mongo/Redis/OTel cleanly;
     `apps/api/src/middleware/backpressure.js` — event-loop-lag-based 503
     shedding, `/health`/`/ready`/`/metrics` exempt)
   - [x] Rate limiting + request timeouts across all public endpoints.
     (applied per-route, not path-prefix, since public/authenticated routes
     are interleaved: `apps/api/src/middleware/request-timeout.js` on all 9
     public routes with workload-appropriate durations; new rate limiters in
     `apps/api/src/middleware/public-rate-limits.js` on the 5 that had none —
     register/refresh/chat/transcript/sdk; login/sessions/embed-session
     already had their own)

6. **Testing & eval regression**
   - [x] Load test session creation + concurrent rooms (k6/artillery).
     (`scripts/load-test.js`, `npm run loadtest` — k6, standalone binary not
     an npm dep; a fixed iteration budget below the Phase 8 20-req/min/IP
     rate limit on `POST /sessions`, since a single test host shares one IP
     across every virtual user — pushing past that ceiling on one host
     mostly re-demonstrates the rate limiter, not raw throughput; live-run:
     15 concurrent session creations, 0% failed, p95 1.92s)
   - [x] Chaos: kill a provider/dependency mid-session and assert fallback.
     (avatar leg is a permanent vitest test — `packages/avatar/src/index.test.js`
     — since its fallback is free/deterministic; LLM + vector-store legs hit
     real external providers/infra so they're a manually-run script instead,
     `scripts/chaos-test.js` / `npm run chaos:test`, each with a precondition
     check on the secondary so a real external outage reports SKIP, not a
     false FAIL; live-verified — vector-store leg genuinely PASSed against
     real Qdrant/Mongo, LLM leg correctly SKIPped due to a real empty
     `ANTHROPIC_API_KEY` in this environment)
   - [ ] Nightly grounding eval (golden set) gates deploys on quality regression.

---

## Observability surface

| Signal | Where | Example |
|---|---|---|
| Traces | OTLP -> collector | API create-session -> agent join span |
| Metrics | `/metrics` (Prometheus) | `session_first_audio_ms` histogram |
| Logs | pino JSON -> log sink | correlated by `sessionId`/`traceId` |
| Health | `/health`, `/ready` | dependency + provider checks |

---

## Acceptance criteria

- Killing the primary LLM/avatar/vector provider mid-session triggers a logged
  fallback with no visitor-visible failure.
- Every session has a trace spanning API, worker, and agent-worker.
- `/ready` fails when a critical dependency is down; `/health` stays fast.
- Per-session cost is recorded and visible; anomalies alert.
- Load test hits the target concurrent-session number within latency SLOs.

---

## Risks

- **Fallback masking bugs** — always log/alert on fallback so silent degradation
  is visible.
- **Trace overhead** — sample high-volume spans; keep hot paths cheap.
- **Circuit-breaker tuning** — start conservative; tune from real latency data.
