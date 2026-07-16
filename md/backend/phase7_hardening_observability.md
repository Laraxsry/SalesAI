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
   - Configure ordered fallbacks per capability, e.g.
     `LLM: [realtime, chained]`, `avatar: [tavus, voice-only]`,
     `vector: [mongo, qdrant]`.
   - Wrap provider calls with timeouts, retries (jittered backoff), and circuit
     breakers; on trip, switch to the next provider and log the reason.
   - Avatar attach failure already falls back to voice-only; generalize the
     pattern to all providers.

2. **Tracing & log correlation** ([`@repo/logger`](../../packages/logger))
   - Propagate a `traceId`/`sessionId` from the API through BullMQ jobs into the
     agent-worker; attach to every log line (pino) and span (OpenTelemetry).
   - Export traces to an OTLP collector (Tempo/Jaeger/Datadog).

3. **Metrics & health**
   - Emit Prometheus metrics: request rate/errors/duration (RED), queue depth,
     job latency, session join time, first-audio latency, tool-call latency.
   - `GET /health` (liveness) and `GET /ready` (deps: Mongo, Redis, LiveKit,
     provider reachability) for orchestrator probes.

4. **Cost tracking**
   - Attribute token/minute usage to `traceId`/`sessionId`; roll into
     `UsageRecord` (Phase 6) and a cost dashboard metric.
   - Alert on anomalous per-session cost (runaway tour/vision loops).

5. **Resilience patterns**
   - Idempotent job handlers; dead-letter queue for poison jobs.
   - Graceful shutdown (drain sessions/jobs) and backpressure on the API.
   - Rate limiting + request timeouts across all public endpoints.

6. **Testing & eval regression**
   - Load test session creation + concurrent rooms (k6/artillery).
   - Chaos: kill a provider/dependency mid-session and assert fallback.
   - Nightly grounding eval (golden set) gates deploys on quality regression.

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
