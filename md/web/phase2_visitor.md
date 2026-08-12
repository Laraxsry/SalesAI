# Web — Phase 2: Visitor Experience

> App: [`apps/visitor`](../../apps/visitor) (React 19 + Vite + LiveKit).
> Goal: a polished, zero-friction page where a customer talks to the AI rep with
> voice and a visual avatar.

---

## Scope

- [x] `/v/:token` route: auto-create session, join LiveKit room, render agent.
- [x] Avatar rendering per provider config.
- [x] Mic permission + connection states; captions; end-session.
- [x] Embeddable mode (`?embed=1`) for the SDK widget iframe.

---

## Flow

```mermaid
sequenceDiagram
    participant U as Visitor
    participant V as Visitor app
    participant API
    participant LK as LiveKit
    participant AW as agent-worker
    U->>V: open /v/:token
    V->>API: POST /sessions { shareToken }
    API-->>V: { roomName, token, livekitUrl }
    V->>LK: connect (mic)
    AW->>LK: dispatched into room
    AW-->>LK: agent audio + avatar video
    LK-->>V: render avatar + play audio
```

See [`Visit.jsx`](../../apps/visitor/src/Visit.jsx).

---

## Avatar rendering

- `voice-only`: 2D orb/waveform driven by the agent audio track levels.
- `tavus`/`heygen`/`did`: subscribe to the avatar's **video track** and render it.
- `simli`: initialize `simli-client` in LiveKit mode with `faceId` from
  `getClientConfig()`.

The app reads the provider config returned with the session and picks the
renderer accordingly.

---

## UX details

- Pre-join: friendly intro + "Allow microphone" with clear copy.
- In-call: avatar centered, live captions, mute, "share my screen", end.
- Screen-share button publishes the visitor's screen track (enables mode B).
- Errors: mic blocked, link expired, agent paused -> graceful messages.
- `POST /sessions` çağrısının (session mint) tek seferlik olduğu garanti edildi —
  `Visit.jsx`'teki `useEffect`, React 18 StrictMode'un dev-only çift-çalıştırma davranışına
  (mount → cleanup → tekrar mount) karşı korumasızdı: `POST /sessions` iki kez tetiklenip
  arka planda 2 ayrı gerçek session + LiveKit odası + agent-worker dispatch'i oluşturuyordu
  (tarayıcı sadece birine bağlanıyordu, diğeri hiç kimse katılmadan yapayalnız kalıp DB'de
  `live` takılı kalıyordu). `startedForTokenRef` (token bazlı, StrictMode'un simüle ettiği
  remount'ta sıfırlanmayan bir ref) ile fetch artık aynı token için en fazla bir kez
  tetikleniyor. **Not:** ilk düzeltme, eski koddaki `ignore` bayrağıyla çakışıp yeni bir
  regresyon yarattı — fetch tek seferde tetiklendiği için `ignore`'un koruduğu "stale
  response" senaryosu artık imkânsızdı, ama StrictMode'un simüle cleanup'ı yine de tek
  (ve gerçek) fetch'in kendi `ignore`'unu `true` yapıp `setConn(data)`'yı sessizce iptal
  ediyordu — sayfa "AI temsilciye bağlanılıyor…" ekranında sonsuza kadar takılı kalıyordu
  (backend'de session başarıyla oluşmasına rağmen). `ignore` mekanizması tamamen kaldırılarak
  düzeltildi.

---

## Acceptance criteria

- [x] Open a link, allow mic, and hold a two-way voice conversation.
- [x] The avatar renders correctly for the agent's configured provider.
- [x] Captions reflect the live transcript.
- [x] `?embed=1` renders cleanly inside the SDK iframe.
