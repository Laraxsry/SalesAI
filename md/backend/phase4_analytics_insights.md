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

1. **Post-call analysis** ([`worker-general`](../../apps/worker-general)) *(Compass ve Walkthrough ile doğrulandı)*
   - [x] On session end, enqueue `analyze-session` via `PATCH /sessions/:id/end`
     (Seçenek A — `apps/api/src/routes/sessions.js` → `enqueue(QUEUES.GENERAL, 'analyze-session', { sessionId })`).
   - [x] Build a summary from `messages`: TL;DR, topics discussed, objections raised,
     questions the KB could not answer, next-step recommendation
     (`apps/worker-general/src/handlers/analyze-session.js` — `gpt-4o-mini`, max 60 mesaj cap).
   - [x] Sentiment per turn + overall; drop-off point (last visitor turn before exit).
   - [x] Persist to `SessionSummary`; emit `session:summary` over Socket.IO
     (`publishEvent('session:summary', ...)` via `@repo/realtime`).

2. **Event stream** ([`@repo/realtime`](../../packages/realtime)) *(Console testi ile doğrulandı)*
   - [x] `SessionEvent` modeli oluşturuldu (`packages/database/src/models/SessionEvent.js`):
     `session_started`, `tool_called`, `tour_started`, `screen_shared`, `handoff_requested`, `session_ended`.
   - [x] `RT_EVENTS.SESSION_SUMMARY` ve `RT_EVENTS.LEAD_CAPTURED` sabitleri eklendi
     (`packages/realtime/src/index.js`).

3. **Rollups & aggregation** *(Postman API istekleri ile doğrulandı)*
   - [x] Scheduled job: `rollup-hourly` (`0 * * * *`) — saatlik AnalyticsRollup
     (`apps/worker-general/src/handlers/rollup-analytics.js`, idempotent upsert).
   - [x] `GET /analytics/agents/:id` returns KPIs + time series over a date range
     (completionRate, unansweredRate, timeSeries eklendi — `apps/api/src/routes/analytics.js`).
   - [x] `GET /analytics/products/:id/topics` returns top topics/objections
     (SessionSummary aggregate — `apps/api/src/routes/analytics.js`).

4. **Lead capture & scoring** *(Compass leads tablosu üzerinden skoralama doğrulandı)*
   - [x] Extract contact intent (email/company asked, demo booked) into `Lead`
     (`apps/worker-general/src/handlers/extract-lead.js` — regex tabanlı sinyal tespiti).
   - [x] Score leads from engagement signals (duration, tour completion, buying
     questions): email +20, demo_intent +30, tour_completed +30, long_session +20.
   - [x] Expose `GET /analytics/leads` (workspaceId scope, status/minScore filtreleri).
   - [ ] Optional webhook/CRM push (`POST /integrations/crm/lead`) — Phase 5+ için ertelendi.

5. **Transcript search** *(Postman full-text search ile doğrulandı)*
   - [x] `GET /sessions/search?q=` full-text over `messages` ($text search),
     scoped by workspace and filterable by agent/date/sentiment
     (`apps/api/src/routes/sessions.js`).

6. **Knowledge-gap loop** *(Postman kümülatif rapor aggregation ile doğrulandı)*
   - [x] Aggregate unanswered questions across `SessionSummary` documents.
   - [x] Expose `GET /analytics/knowledge-gaps` (product scope, sorted by count).

7. **Console CRUD Management** *(Walkthrough Bölüm 8 - Postman ve Otomatik Testlerle doğrulandı)*
   - [x] `PATCH /agents/:id` — Persona/tone/avatar gibi alanların partial update edilmesi. *(Postman testleri ile partial veri güncellemesinin veritabanına sorunsuz yansıdığı onaylandı).*
   - [x] `DELETE /agents/:id` — Agent silme, bağlı share-link'lerin cascade silinmesi (live guard dahil). *(Live session esnasında 409 Conflict hatasının başarıyla fırlatıldığı ve normal silmede ShareLink kayıtlarının temizlendiği doğrulandı).*
   - [x] `PATCH /products/:id` — Product adı/açıklaması partial update (Workspace üyelik guard). *(Tenant ve workspace scope kontrolünün başarıyla çalıştığı teyit edildi).*
   - [x] `DELETE /products/:id` — Product silme, bağlı agent/link cascade silinmesi (live guard dahil). *(Altındaki ajanlardan birinde dahi live session varsa ürünün silinmesi engelleniyor, engelsiz durumda ajanlarla beraber başarılı cascade sağlanıyor).*
   - [x] `DELETE /sessions/:id` — Session silme, GDPR gereği bağlı mesajların cascade silinmesi (live guard dahil). *(Ended durumundaki session silindiğinde messages koleksiyonundaki bağlı tüm kayıtların sıfırlandığı teyit edildi).*
   - **(Güvenlik / Validasyon Notu):** `/:id` içeren tüm CRUD ve endpoint'lerde, geçersiz MongoDB ObjectId formatı gelmesi durumunda 500 `CastError` fırlatması yerine, doğrudan `404 Not Found` döndürecek regex tabanlı alfasayısal karakter (24 hex) validasyonu eklendi.

---

## Data model additions

| Collection | Key fields |
|---|---|
| `SessionSummary` | `sessionId`, `tldr`, `topics[]`, `objections[]`, `unanswered[]`, `sentiment`, `dropOff`, `nextStep`, `generatedAt` |
| `SessionEvent` | `sessionId`, `type`, `at`, `meta` |
| `AnalyticsRollup` | `scope` (agent/product), `scopeId`, `bucket` (hour/day), `bucketAt`, `metrics{}` — compound unique index |
| `Lead` | `sessionId`, `workspaceId`, `agentId`, `contact{}`, `score`, `status`, `signals[]` |

---

## Acceptance criteria

- [x] Ending a session (`PATCH /sessions/:id/end`) enqueues `analyze-session` → `SessionSummary` üretilir.
- [x] `GET /analytics/agents/:id` returns accurate session counts, avg duration,
  completion rate, and unanswered rate for a date range.
- [x] A conversation that asks to book a demo creates a scored `Lead` (demo_intent +30).
- [x] Transcript search returns matching turns scoped to the caller's workspace.
- [x] The knowledge-gaps report lists real unanswered questions.
- [x] Missing Console CRUD endpoints (PATCH/DELETE for Agent/Product, DELETE for Session) handle cascade deletes properly. *(Tüm DELETE rotalarının ShareLink, Message ve Agent bağlı verilerini temizlediği doğrulandı).*
- [x] Resources cannot be deleted while an active live session exists (409 Guard). *(Agent, Product ve Session bazında status='live' kalkanı başarıyla devrede).*

*(Yukarıdaki tüm kabul kriterleri bizzat oluşturulan Walkthrough ve CRUD Manual Test Guide ile Postman üzerinden uçtan uca doğrulanmıştır. 22.07.2026)*

---

## Risks

- **Analysis cost** — batch summaries with a cheaper model (gpt-4o-mini); cap transcript size (MAX_MESSAGES_FOR_ANALYSIS = 60).
- **PII in transcripts** — redact before storing summaries (see Phase 8).
- **Rollup drift** — make jobs idempotent and re-runnable by bucket (upsert pattern uygulandı).

---

## Test

```bash
node backend_tests/phase4_analytics_insights.mjs
```

11 test (5 kaynak kodu, 6 HTTP/DB):
- analyze-session.js kaynak doğrulama (gpt-4o-mini, persist, publishEvent)
- extract-lead.js kaynak doğrulama (sinyal tespiti, scoring, upsert)
- rollup-analytics.js kaynak doğrulama (idempotent upsert)
- worker-general/main.js kaynak doğrulama (job case'leri, cron)
- RT_EVENTS doğrulama (session:summary, lead:captured)
- GET /analytics/agents/:id → KPI + time series
- GET /analytics/agents/:id/summary → SessionSummary listesi
- GET /analytics/products/:id/topics → topics aggregation
- GET /analytics/leads → lead listesi + minScore filtresi
- GET /analytics/knowledge-gaps → unanswered sorular
- PATCH /sessions/:id/end → session bitişi + idempotent guard
- PATCH /agents/:id → persona update
- DELETE /agents/:id → cascade silme + live guard
- PATCH /products/:id → update
- DELETE /products/:id → cascade silme + live guard
- DELETE /sessions/:id → cascade mesaj silme + live guard
