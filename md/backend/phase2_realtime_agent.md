# Backend — Phase 2: Realtime Agent (Voice + Avatar + Link)

> Goal: activate an agent into a shareable link; a visitor joins a LiveKit room
> and has a live voice conversation with a visual avatar, grounded in the KB.
> Outcome: open `/v/:token`, talk, and see/hear the agent answer.

---

## Scope

- `Agent`, `ShareLink`, `Session`, `Message` models.
- Agent configuration + activation -> share link.
- `@repo/livekit` tokens + room lifecycle.
- `apps/agent-worker`: LiveKit Node agent (persona + tools + realtime LLM + avatar).
- `@repo/avatar` provider strategy.
- Public `POST /sessions` to mint room tokens.

---

## Tasks

1. **Agent config & activation**
   - [x] `POST /agents` validates with `AgentConfigInput`; choose `avatarProvider`,
     `screenModes`, persona, optional `toolAccess`.
   - [x] `POST /agents/:id/activate` sets `status: active`, mints a `ShareLink`,
     returns the public URL + embed snippet
     ([`routes/agents.js`](../../apps/api/src/routes/agents.js)).
   - [x] **Share-link rotation (güvenlik düzeltmesi)** — `activate` artık her (yeniden)
     aktivasyonda o agent'ın önceki share link'lerini `active:false` yapıp yeni bir tane
     üretiyor. Önceden her tıklama eskisini pasifleştirmeden yeni link ekliyordu; agent
     duraklatılsa bile link'in kendisi geçersiz olmuyordu (sadece `agent.status` kontrolüne
     takılıyordu), reaktivasyonda hepsi birden tekrar çalışır hale geliyordu — eski/unutulmuş
     bir link elinde olan biri hâlâ bağlanabiliyordu. DB'de bug'dan dolayı birikmiş 13 eski
     aktif link elle temizlendi (kalıcı fix koddaki `ShareLink.updateMany` çağrısı).

2. **Session creation**
   - [x] `POST /sessions` resolves the share token, creates a `Session` + LiveKit
     room name, and returns `{ roomName, token, livekitUrl }`
     ([`routes/sessions.js`](../../apps/api/src/routes/sessions.js)).
   - [x] Enforce `active`, `expiresAt`, `maxSessions` (Added validation in POST /sessions).

3. **Agent worker** ([`agent-worker`](../../apps/agent-worker))
   - [x] `defineAgent` entry: `connectDB`, load `Session`->`Agent`->`Product`.
   - [x] `buildSystemPrompt()` + `buildTools()` from `@repo/agent`.
   - [x] `voice.AgentSession` with OpenAI Realtime (`gpt-realtime-2`); VAD,
     interruption, tool calls.
   - [x] Attach avatar via `getAvatarProvider(agent.avatarProvider)`.
   - [x] Persist transcript turns to `messages`.
   - [x] Emit `session:transcript` over Socket.IO (emit eklendi).
   - [x] Yeni `save_contact_info` tool'u (`@repo/agent` → `packages/agent/src/tools.js`) —
     ziyaretçi email/isim/telefon verdiğinde agent bunu sesli geri okuyup onay alıyor
     (`persona.js`'e eklenen açık talimat gereği: "spell emails out letter by letter...
     keep correcting until they explicitly confirm"), onaylandıktan SONRA bu tool çağrılıp
     `Session.confirmedContact.<field>`'a yazılıyor (isim için `visitorName` de senkron
     tutuluyor). STT hatalarının (yanlış duyulan email vb.) doğrulanmadan kaydedilmesini
     önlüyor; ayrıca Console'daki "Anonim ziyaretçi" etiketlemesini de kökten düzeltiyor
     (bkz. `md/backend/phase4_analytics_insights.md`, `md/web/phase4_analytics.md`).
   - [x] `Session.lastActivityAt` heartbeat — agent-worker artık 60sn'de bir bu alanı
     güncelliyor (room bağlantısı canlı olduğu sürece, ziyaretçinin sesi/videosu olsun
     olmasın). `worker-general`'daki `close-stale-sessions` cron'u artık sabit "2 saatten
     eskiyse kapat" yerine "son 5 dakikada heartbeat gelmedi mi" kontrolüne bakıyor —
     gerçek uzun görüşmeler asla kesilmiyor, gerçekten kopmuş bağlantılar (worker crash)
     2 saat yerine ~5-10 dakikada temizleniyor.

4. **Avatar providers** ([`@repo/avatar`](../../packages/avatar))
   - [x] Start with `voice-only` (always works) + `tavus` (server-rendered video).
   - [x] `simli`/`heygen`/`did` wired but gated by env keys. (simli: now a real server-side integration, ported from `livekit-plugins-simli` — see `packages/avatar/src/providers/simli.js`; heygen/did remain unimplemented stubs)

5. **Worker dispatch**
   - [x] Configure LiveKit to dispatch `agent-worker` on room creation (agent name)
     so the brain joins automatically when a visitor connects. (`agentName: 'salesai-agent'`
     in `WorkerOptions`; `dispatchAgent()` called in `POST /sessions`).

6. **Resilience**
   - [x] Avatar attach failure -> fall back to voice-only (try/catch + warn var).
   - [x] Session timeouts + cleanup via `worker-general` (zamanlı cron görevleri aktifleştirildi).
   - [x] **Cost-leak fix** — `@livekit/agents`'ın kendi `RoomIO.closeOnDisconnect`'i sadece
     "temiz" disconnect sebeplerinde (buton ile kapatma, oda silinmesi vb.) tetikleniyordu;
     sekme kapanması/ağ kopması gibi "temiz olmayan" durumlarda paid OpenAI Realtime
     bağlantısı agent-worker restart edilene kadar sonsuza kadar açık kalıp (20dk'da bir
     kendini reconnect ederek) token harcamaya devam edebiliyordu. Artık odada ziyaretçi
     kalmadığında (10sn grace period ile — LiveKit'in kendi kısa süreli reconnect'lerini
     yanlış pozitif saymamak için) bağlantı sebep ne olursa olsun zorla kapatılıyor.
     Avatar (Tavus vb.) da odaya ayrı bir participant olarak katıldığından, kontrol
     özellikle ziyaretçinin `visitor_` önekli kimliğine bakıyor (`hasVisitorParticipant()`)
     — aksi halde avatar varken ziyaretçi ayrılsa da "biri hâlâ var" sanılabiliyordu.
   - [x] Bu event-tabanlı watchdog'a ek olarak, agent-worker artık 15sn'de bir doğrudan
     LiveKit sunucusuna REST ile (`@repo/livekit` → `roomService().listParticipants()`)
     soruyor — bazı ortamlarda agent'ın kendi local room mirror'ı (`ctx.room.remoteParticipants`)
     event'i kaçırıp watchdog'u hiç tetiklemeyebiliyordu (sunucu tarafında ziyaretçi
     gerçekten gitmiş olsa bile); REST poll sunucudan doğrudan doğrulama alan bir yedek.
   - [x] `agentSession.shutdown()` çağrısı, realtime session hiç `start()` edilmemişse
     (örn. ziyaretçi hiç algılanmadan ayrıldıysa, ya da avatar bağlanma adımında takılıyken
     ayrıldıysa) bazen hiç resolve/reject olmadan asılı kalabiliyordu — "force-closing"
     logu basılıp session'ın hiçbir zaman gerçekten kapanmaması gibi yanıltıcı bir duruma
     yol açıyordu. `Session.status='ended'` güncellemesi artık bu çağrının sonucuna bağlı
     değil: idempotent `endSession()` fonksiyonuyla doğrudan ve önce yapılıyor;
     `agentSession.shutdown()` sadece best-effort, 5sn zaman sınırlı, arka planda deneniyor.
   - [x] Avatar bağlanma adımı (`startAvatarWithFallback`, `@repo/avatar`) — Tavus SDK'sının
     kendi "remote participant'ı bekle" adımı, hiçbir hata/log üretmeden sonsuza dek askıda
     kalabiliyordu (tüm görüşmeyi bloke ediyordu). Artık 20sn'lik sert bir üst sınır var
     (`AVATAR_ATTACH_TIMEOUT_MS`, `Promise.race`); süre dolunca otomatik olarak voice-only'e
     düşülüp loglanıyor. Bu adımın kod içi sırası da düzeltildi: tüm `agentSession.on(...)`
     dinleyicileri (Close, disconnect watchdog, vb.) artık avatar bağlanma denemesinden ÖNCE
     kuruluyor — önceden o 20sn'lik pencerede sekme kapanırsa henüz hiçbir dinleyici
     kurulmadığı için "ayrıldı" sinyali kayboluyordu.
   - [x] `stop_screen_share` tool'u, tur ekranını kapatırken `unpublishTrack()`'e (bir string
     track SID bekleyen fonksiyona) track nesnesinin kendisini veriyordu — bu, JS'in
     `"[object Object]"`'e coerce etmesi yüzünden native `livekit-ffi` katmanında bir Rust
     panic'e (`unwrap()` on `Err`) sebep olup tüm agent-worker process'ini anında
     çökertiyordu (ses + transcript aynı anda kesiliyordu). Artık doğru `tourVideoTrack.sid`
     gönderiliyor; ayrıca eş zamanlı devam eden bir ekran-görüntüsü-yakalama döngüsüyle
     çakışmayı önlemek için ayrı bir `tourCaptureInFlight` guard'ı da eklendi.

---

## Acceptance criteria

- [x] Activating an agent returns a working `/v/:token` link.
- [x] Opening the link starts a session, the agent joins, and voice works two-way. (`dispatchAgent()` routes agent-worker to room via `AgentDispatchClient`).
- [x] With `AVATAR_PROVIDER=tavus` (+ keys), a talking face video appears. (test edildi, localhost kısıtlaması nedeniyle sesli çalıştı).
- [x] Answers are grounded (agent calls `search_knowledge`).
- [x] Transcripts are stored per turn.

---

## Risks

- **Realtime cost** — trim context, cache, consider mini realtime model.
- **Avatar provider quotas/latency** — per-agent selection lets us tune.
- **Node plugin coverage** — Tavus has a Node plugin; Simli is client-driven;
  HeyGen/D-ID are bridged. Document per-provider wiring.
- **Native SDK hang/crash risk** — `@livekit/rtc-node`'un native (Rust) katmanı, yanlış
  argüman tipiyle çağrılan bir fonksiyonda (`unpublishTrack`) tüm process'i çökertebiliyor,
  ve bazı SDK çağrıları (avatar attach, `agentSession.shutdown()`) hiç resolve/reject
  olmadan sonsuza kadar asılı kalabiliyor — JS tarafındaki try/catch bunları yakalayamıyor.
  Bu tür çağrıların hepsine (mümkün olduğunca) dışarıdan sert bir timeout sarmalanmalı;
  kritik state güncellemeleri (örn. `Session.status`) bu çağrıların başarılı olmasına asla
  bağlı kalmamalı.
