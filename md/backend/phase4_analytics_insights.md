# Backend — Phase 4: Analytics & Insights

> Goal: turn every conversation into structured insight — topics, objections,
> sentiment, drop-off, and lead quality — so sellers understand what visitors
> ask and how well the agent performs.
> Outcome: an analytics API that powers the console dashboard and a per-session
> post-call summary generated automatically when a session ends.

---

## Scope

- `SessionSummary`, `SessionEvent`, `AnalyticsRollup`, `Lead` models.
- Post-call analysis pipeline (summary, topics, sentiment, action items).
- Aggregation endpoints for the console dashboard (KPIs + time series).
- Lead capture + scoring from conversations.
- Conversation search across transcripts.

---

## Tasks

1. **Post-call analysis** ([`worker-general`](../../apps/worker-general))
   - On `session:ended`, enqueue `analyze-session`.
   - Build a summary from `messages`: TL;DR, topics discussed, objections raised,
     questions the KB could not answer, next-step recommendation.
   - Sentiment per turn + overall; drop-off point (last visitor turn before exit).
   - Persist to `SessionSummary`; emit `session:summary` over Socket.IO.

2. **Event stream** ([`@repo/realtime`](../../packages/realtime))
   - Record discrete `SessionEvent`s (`session_started`, `tool_called`,
     `tour_started`, `screen_shared`, `handoff_requested`, `session_ended`).
   - Events are the raw material for funnels and time-on-stage metrics.

3. **Rollups & aggregation**
   - Scheduled job rolls hourly/daily counts per agent/product into
     `AnalyticsRollup` (sessions, avg duration, completion rate, unanswered rate).
   - `GET /analytics/agents/:id` returns KPIs + time series over a date range.
   - `GET /analytics/products/:id/topics` returns top topics/objections.

4. **Lead capture & scoring**
   - Extract contact intent (email/company asked, demo booked) into `Lead`.
   - Score leads from engagement signals (duration, tour completion, buying
     questions); expose `GET /analytics/leads`.
   - Optional webhook/CRM push (`POST /integrations/crm/lead`).

5. **Transcript search**
   - `GET /sessions/search?q=` full-text over `messages` (Mongo text index),
     scoped by workspace and filterable by agent/date/sentiment.

6. **Knowledge-gap loop**
   - Aggregate unanswered questions into a "knowledge gaps" report per product
     so sellers know what content to add next.

---

## Data model additions

| Collection | Key fields |
|---|---|
| `SessionSummary` | `sessionId`, `tldr`, `topics[]`, `objections[]`, `unanswered[]`, `sentiment`, `dropOff`, `nextStep` |
| `SessionEvent` | `sessionId`, `type`, `at`, `meta` |
| `AnalyticsRollup` | `scope` (agent/product), `scopeId`, `bucket` (hour/day), `metrics{}` |
| `Lead` | `sessionId`, `workspaceId`, `contact{}`, `score`, `status`, `signals[]` |

---

## Acceptance criteria

- Ending a session produces a `SessionSummary` within seconds.
- `GET /analytics/agents/:id` returns accurate session counts, avg duration,
  completion rate, and unanswered rate for a date range.
- A conversation that asks to book a demo creates a scored `Lead`.
- Transcript search returns matching turns scoped to the caller's workspace.
- The knowledge-gaps report lists real unanswered questions.

---

## Risks

- **Analysis cost** — batch summaries with a cheaper model; cap transcript size.
- **PII in transcripts** — redact before storing summaries (see Phase 8).
- **Rollup drift** — make jobs idempotent and re-runnable by bucket.
