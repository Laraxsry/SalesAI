# Web — Phase 4: Analytics Dashboard (Console)

> App: [`apps/console`](../../apps/console) (React 19 + Vite + Tailwind v4).
> Goal: give sellers a clear picture of how their agents perform — sessions,
> topics, objections, sentiment, leads, and the content gaps to fix next.
> Consumes the backend analytics API (backend Phase 4).

---

## Scope

- Overview dashboard with KPI cards + time-series charts.
- Per-agent and per-product analytics drill-downs.
- Conversation explorer: searchable transcript list + detail view with summary.
- Leads inbox with scoring and status.
- Knowledge-gaps report that links straight into the knowledge manager.

---

## Routes

| Route | Purpose |
|---|---|
| `/` | Overview: KPIs, trends, recent sessions, top topics |
| `/analytics` | Full analytics: filters (agent, product, date range) |
| `/agents/:id/sessions` | Session list + transcript/summary detail |
| `/leads` | Leads inbox: score, status, contact, source |
| `/knowledge/gaps` | Unanswered questions -> add-source shortcuts |

---

## Key UX

- **KPI cards**: total sessions, avg duration, completion rate, unanswered rate,
  qualified leads — each with a period-over-period delta.
- **Charts** (Recharts/visx): sessions over time, sentiment distribution,
  tour-vs-voice-only usage, funnel (joined -> engaged -> demo -> lead).
- **Conversation explorer**: search box (hits the transcript search API),
  filter chips (sentiment, agent, date), row -> detail drawer with the
  auto-summary (TL;DR, topics, objections, next step) and full transcript.
- **Leads inbox**: sortable by score; status workflow (`new -> contacted -> won/lost`);
  one-click export / CRM push.
- **Knowledge gaps**: ranked unanswered questions with "add knowledge" CTA that
  deep-links to the source form pre-filled with the topic.

---

## Tech

- Server state: React Query with date-range + filter query keys.
- Charts: a small chart lib (Recharts) wrapped in `@repo/ui`.
- Live updates: Socket.IO subscription refreshes KPIs on `session:ended` /
  `session:summary`.
- CSV export for tables via a shared exporter util.

---

## Acceptance criteria

- The overview shows accurate KPIs and trends for the selected date range.
- Filtering by agent/product/date updates every widget consistently.
- Searching transcripts returns matching conversations; the detail view shows
  the generated summary and full turns.
- New qualified leads appear in the inbox with a score and source tag.
- The gaps report links to the knowledge manager for the missing topic.

---

## Risks

- **Large transcript rendering** — virtualize long conversation lists.
- **Chart overload** — start with the few KPIs that drive decisions.
- **Timezone correctness** — render buckets in the workspace's timezone.
