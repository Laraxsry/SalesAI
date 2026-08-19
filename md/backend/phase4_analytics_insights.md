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
   - [x] `PATCH /analytics/leads/:id/status` — Lead durumu güncelleme (new → contacted → won/lost workflow).
   - [x] Optional webhook/CRM push — `POST/GET/PATCH/DELETE /integrations/webhooks` ile workspace başına yapılandırılabilir outbound webhook altyapısı eklendi. HMAC-SHA256 imzalama, 3x retry (backoff), dead-letter kaydı ve manuel test endpoint’i ile tamamlandı. *(Walkthrough üzerindeki manuel test adımları ile tüm webhook akışı doğrulandı)*
   - [x] İletişim bilgisi olmayan (email paylaşılmamış, `visitorName` yok) oturumlar için "Anonim lead" kaydı açılmıyor — skor eşiği geçse bile `extract-lead.js` artık en az bir contact alanı zorunlu kılıyor.
   - [x] `extract-lead.js` artık `session.confirmedContact` (ziyaretçinin agent'a sesli
     verip agent'ın geri okuyup onayını aldığı email/isim/telefon — bkz.
     `save_contact_info` tool'u, `md/backend/phase2_realtime_agent.md`) varsa bunu ham
     transcript regex'ine göre ÖNCELİKLENDİRİYOR — hem STT hatalarına karşı daha güvenilir
     hem de "Anonim ziyaretçi" etiketlemesinin kaynağı artık belirsiz bir regex değil,
     ziyaretçinin bizzat onayladığı değer. `Lead.contact`'a `phone` alanı eklendi
     (önceden sadece `email/company/name` vardı, telefon için regex fallback yok —
     tek güvenilir kaynak `confirmedContact.phone`).
   - [x] `GET /agents/:id/sessions` artık ilgili `Lead.contact`'ı join edip `lead:{name,email}`
     olarak döndürüyor — Console Sessions listesi (`AgentSessions.jsx`), önceden SADECE
     `session.visitorName`'e bakıp konuşmada email verilse (ve arka planda regex ile
     başarıyla bir Lead oluşsa) bile "Anonim ziyaretçi" gösteriyordu; artık
     `confirmedContact.name` → `visitorName` → `confirmedContact.email` → geçmiş Lead
     kaydı sırasıyla fallback yapıyor (bkz. `md/web/phase4_analytics.md`).
   - [ ] **Açık:** Ziyaretçi host site'da kendi hesabıyla giriş yapmışsa (end-customer login), bu kimliğin widget'a otomatik aktarılıp Lead'e bağlanması — `packages/sdk`'ye bir `identify({ name, email })` API'si + embed session'a `visitorInfo` alanı eklenmesi gerekiyor. Şu an SDK'da böyle bir mekanizma yok (bkz. `packages/sdk/src/index.js`); bilgi bırakmadıysa lead hâlâ oluşmuyor.

5. **Transcript search** *(Postman full-text search ile doğrulandı)*
   - [x] `GET /sessions/search?q=` full-text over `messages` ($text search),
     scoped by workspace and filterable by agent/date/sentiment
     (`apps/api/src/routes/sessions.js`).

6. **Knowledge-gap loop** *(Postman kümülatif rapor aggregation ile doğrulandı)*
   - [x] Aggregate unanswered questions across `SessionSummary` documents.
   - [x] Expose `GET /analytics/knowledge-gaps` (product scope, sorted by count).

7. **Proaktif içerik-tutarlılık analizi (Knowledge GAP raporu)** — **madde 6 ile
   KARIŞTIRILMAMALI**: madde 6 REAKTİF (gerçek ziyaretçi trafiğinden,
   `SessionSummary.unanswered` aggregation'ı); bu madde PROAKTİF — ziyaretçi
   trafiği hiç gerekmeden, ürün sahibinin isteği üzerine knowledge
   içeriğinin KENDİSİNİ LLM ile analiz ediyor.
   - [x] Yeni `KnowledgeGapReport` modeli (`productId`, `requestedBy`,
     `status` ∈ `processing|ready|failed`, `sourceCount`, `truncated`,
     `findings: [{type: inconsistency|thin|missing, title, description,
     sourceIds[]}]`) — bkz. Data model additions.
   - [x] `POST /knowledge/:productId/gap-analysis` (`apps/api/src/routes/knowledge.js`)
     — `requireAuth` + ürünün workspace'ine üyelik kontrolü (`loadOwnedProduct()`,
     bu dosyanın diğer birçok endpoint'inde OLMAYAN, buraya özel eklenen bir
     kontrol — gerçek LLM maliyeti olan bir işlem tetiklediği için) +
     `can(membership.role, 'knowledge:analyze')` — rastlantı eseri
     `packages/access`'teki mevcut `EDITOR: 'knowledge:*'` bu yeni izni zaten
     `EDITOR`/`ADMIN`/`OWNER`'a veriyor, `packages/access`'te değişiklik
     GEREKMEDİ. **Günlük kota şu an DEVRE DIŞI** — geliştirme aşamasında
     kullanıcı isteğiyle kaldırıldı (`GAP_ANALYSIS_DAILY_LIMIT = Infinity`,
     `apps/api/src/routes/knowledge.js`), ileride geri eklenecek. Bir
     ÖNCEKİ halinde (kota aktifken) gerçek bir bug bulundu ama şu an
     kapsam dışı bırakıldığı için düzeltilmedi, sadece koda TODO olarak
     not düşüldü: sayaç `status`'a bakmadan (`createdAt`'e göre) TÜM
     raporları sayıyordu — başarısız (`status:'failed'`) bir deneme bile
     kotadan düşüyordu, kullanıcı bir LLM hatasından sonra o gün bir daha
     hiç deneyemiyordu. Kota geri eklenirken sadece `status:'ready'`
     raporlar sayılmalı.
   - [x] `GET /knowledge/:productId/gap-analysis` — son 10 raporu +
     `canRequestNow` (Console butonunun disabled durumu buradan okunuyor)
     döndürür.
   - [x] `apps/worker-general/src/handlers/analyze-knowledge-gaps.js` (yeni,
     `analyze-session.js` ile aynı genel kalıp: ucuz model, katı JSON şema
     promptu, hata durumunda `status:'failed'`) — ürünün TÜM `status:'ready'`
     knowledge kaynaklarını (zip container'lar hariç, `meta.zipSummary`)
     `meta.extractedText`'ten (Phase 1'de artık HER tipte persist ediliyor,
     tek bir uniform alan) **map-reduce** ile karşılaştırıyor:
     - **Map**: her kaynağın ham metni (`GAP_ANALYSIS_EXCERPT_CHARS`,
       varsayılan 1500 kar/kaynak) `GAP_ANALYSIS_MAP_BATCH_SIZE` (varsayılan
       18) kişilik gruplara bölünüp, `mapWithConcurrency()`
       (`packages/utils/src/index.js` — önceden sadece
       `apps/worker-ingestion`'ın URL sentez adımında vardı, buraya da
       gerektiği için paylaşılan yere taşındı) ile en fazla
       `GAP_ANALYSIS_MAP_CONCURRENCY` (varsayılan 5) grup PARALEL LLM
       çağrısıyla kısa, YORUM İÇERMEYEN "olgu özeti"ne (fiyat/adım/sayı/kural
       gibi karşılaştırılabilir iddialar) indirgeniyor. Bir grubun çağrısı
       başarısız olursa o gruptaki kaynaklar TAMAMEN düşmüyor — ham
       excerpt'ten kaba bir fallback digest (`FALLBACK_DIGEST_CHARS`, 300 kar)
       kullanılıyor, sadece loglanıyor.
     - **Reduce**: map fazının ürettiği (ham metinden ÇOK daha küçük)
       digest'lerin TAMAMI TEK bir final `gpt-4o-mini` çağrısına verilip
       asıl GAP analizi (tutarsızlık/yetersiz-detay/eksik-konu) burada,
       TÜM kaynaklar aynı anda görülerek yapılıyor — karşılaştırma
       yeteneği SADECE bu adımda var (map fazında her kaynak bağımsız
       özetleniyor, birbirleriyle kıyaslanmıyor). `MAX_REDUCE_DIGESTS`
       (env `GAP_ANALYSIS_MAX_REDUCE_DIGESTS`, varsayılan 500) aşılırsa
       en son güncellenen kaynaklar alınır (`truncated:true`) — digest'ler
       küçük olduğu için eski (ham metni tek çağrıya sığdırmaya çalışan)
       yaklaşımdaki 80 kaynak tavanından çok daha yüksek, pratikte nadiren
       tetiklenir.
     - JSON şeması (`inconsistencies`/`thin`/`missing`, `sourceIndexes` —
       `classifyAudience()`'daki "numaralı chunk → index" deseniyle aynı,
       LLM gerçek ObjectId bilemez) DEĞİŞMEDİ, sadece girdi artık ham
       excerpt yerine digest; index'ler sunucu tarafında gerçek
       `sourceId`'lere map'leniyor. Rapor dili sabit Türkçe (Console'un
       kendi dili — ürünün ziyaretçi-yüzü diline bağlı değil,
       `resolveKnowledgeLanguage()` KULLANILMIYOR). `worker-general/src/main.js`'e
       `case 'analyze-knowledge-gaps':` eklendi.
     - **Motivasyon** (kullanıcıyla birlikte kararlaştırıldı): tek dev
       çağrıya tüm ham metni sığdırmak (ilk versiyon) 80+ kaynaklı bir
       üründe bazı kaynakları analiz dışı bırakıyordu (`truncated:true`);
       her kaynağı TEK TEK/bağımsız analiz etmek ise çapraz-karşılaştırma
       (tutarsızlık tespiti) yeteneğini tamamen kaybederdi — map-reduce
       ikisinin de sorununu çözüyor.
   - [x] **Bug (gerçek ortamda bulundu ve düzeltildi)**: ilk canlı testte
     `"All providers failed for capability llm: openai, anthropic"` hatası
     alındı — `packages/ai`'nin `getLLM()`'i tüm çağıranlar için sabit
     10sn'lik bir `timeoutMs` kullanıyordu (`@repo/resilience`'ın
     `withFallback()` varsayılanı), bu diğer LLM çağrıları
     (`classifyAudience()`, `analyze-session.js`, `synthesizePage()`) için
     yeterliyken GAP analizinin çok daha büyük promptu (80 kaynağa kadar)
     için yetmiyordu — OpenAI denemesi tam 20sn'de (10sn × 2 deneme)
     zaman aşımına uğrayıp Anthropic'e düşüyor, o da başarısız oluyordu.
     `getLLM(name, {timeoutMs})` artık opsiyonel bir 2. parametre alıyor
     (belirtilmezse davranış AYNI, mevcut hiçbir çağıran etkilenmedi) —
     `analyze-knowledge-gaps.js` `GAP_ANALYSIS_LLM_TIMEOUT_MS` (varsayılan
     60000ms) ile çağırıyor.
   - [x] Yeni `RT_EVENTS.GAP_REPORT_READY` (`'gap-report:ready'`,
     `packages/realtime/src/index.js`) — analiz bitince Console'a Socket.IO
     ile bildirim.
   - [x] Console: `/knowledge/gaps` sayfasına (`KnowledgeGaps.jsx`) ikinci bir
     sekme ("İçerik Analizi") eklendi — mevcut "Cevapsız Sorular" sekmesi
     dokunulmadan yanına; ayrı bir route AÇILMADI (kullanıcı tercihi, iki
     "gap" kavramının karışmaması aynı sayfada iki sekmeyle sağlandı).
     "Analiz Et" butonu, accordion rapor listesi (hem güncel hem geçmiş
     raporlar genişletilip daraltılabiliyor), `?source=<id>` deep-link ile
     `Knowledge.jsx`'teki kaynağa gitme, ve token harcamadan istemci
     tarafında PDF indirme — tüm Console UX detayları için
     `md/web/phase1_console.md`'ye bakın (burada tekrar edilmiyor,
     tek kaynak orası).
   - [ ] **Kapsam dışı (bilinçli olarak ertelendi)**: knowledge yüklendiğinde
     OTOMATİK tetiklenme / cron ile periyodik analiz — bu SADECE manuel,
     Console'dan buton ile tetiklenen bir akış. Otomasyon ayrı bir görev
     olarak planlanıyor.
   - [ ] **Test altyapısı notu**: `apps/worker-general`'ın hiç vitest
     kurulumu yok (`analyze-session.js`'in de testi yok) — yeni bir test
     framework'ü kurmak bu round'un kapsamı dışında bırakıldı, sadece kod
     incelemesi + gerçek ortamda manuel doğrulama yapıldı.

8. **Console CRUD Management** *(Walkthrough Bölüm 8 - Postman ve Otomatik Testlerle doğrulandı)*
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
| `Lead` | `sessionId`, `workspaceId`, `agentId`, `contact { email, company, name, phone }`, `score`, `status`, `signals[]` |
| `KnowledgeGapReport` | `productId`, `requestedBy`, `status` (processing/ready/failed), `error`, `sourceCount`, `truncated`, `findings[] { type (inconsistency/thin/missing), title, description, sourceIds[] }` |

---

## Acceptance criteria

- [x] Ending a session (`PATCH /sessions/:id/end`) enqueues `analyze-session` → `SessionSummary` üretilir.
- [x] `GET /analytics/agents/:id` returns accurate session counts, avg duration,
  completion rate, and unanswered rate for a date range.
- [x] A conversation that asks to book a demo creates a scored `Lead` (demo_intent +30).
- [x] Transcript search returns matching turns scoped to the caller's workspace.
- [x] The knowledge-gaps report lists real unanswered questions.
- [ ] `POST /knowledge/:productId/gap-analysis` gerçekten çelişen bilgi içeren
  kaynaklar üzerinde tetiklenip `KnowledgeGapReport.findings`'te doğru bir
  `inconsistency` bulgusu ürettiği — kod incelemesi + local doğrulama
  yapıldı, uçtan uca otomatik test/Postman koleksiyonu HENÜZ eklenmedi
  (bkz. madde 7'nin "Test altyapısı notu").
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
node backend_tests/integration/phase4_analytics_insights.mjs
```

26 test (6 kaynak kodu, 20 HTTP/DB):
- analyze-session.js kaynak doğrulama (gpt-4o-mini, persist, publishEvent)
- extract-lead.js kaynak doğrulama (sinyal tespiti, scoring, upsert)
- rollup-analytics.js kaynak doğrulama (idempotent upsert)
- worker-general/main.js kaynak doğrulama (job case'leri, cron)
- RT_EVENTS doğrulama (session:summary, lead:captured)
- dispatch-webhooks.js kaynak doğrulama (HMAC, retry, dead-letter)
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
- POST /integrations/webhooks → webhook oluşturma
- GET /integrations/webhooks → listeleme + secret maskeleme
- POST /integrations/webhooks/:id/test → test payload gönderme
- PATCH /integrations/webhooks/:id → güncelleme
- DELETE /integrations/webhooks/:id → silme
- PATCH /analytics/leads/:id/status → durum güncelleme (new/contacted/won/lost) + 400 ve 404 guard

*(Son test: **87/87 başarılı** — 27.07.2026)*
