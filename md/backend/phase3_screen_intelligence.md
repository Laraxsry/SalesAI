# Backend — Phase 3: Screen Intelligence

> Goal: the agent can both **demonstrate** the product (drive a browser) and
> **observe** the customer's shared screen, guiding them in real time.
> Outcome: "show me how billing works" triggers a live tour; a confused customer
> shares their screen and the agent points them to the next click.

---

## Scope

- `@repo/screen`: `GuidedTour` (Playwright) + `analyzeFrame` (vision).
- Tour video published into the LiveKit room as the agent's screen.
- Customer screen-share track sampling + vision understanding.
- Tool handlers wired in `agent-worker` for tour + screen tools.

---

## Tasks

1. **Guided tour (mode A)**
   - [x] `GuidedTour.open({ startUrl })` launches a headless Chromium of the product.
   - [x] Tool handlers: `start_guided_tour`, `navigate_to`, `highlight`.
   - [x] Publish frames into LiveKit as a video track — Playwright PNG → `sharp` RGBA → `VideoSource.captureFrame()` @ ~1 FPS; `LocalVideoTrack` published as `screen_share`.
   - [x] Optional Browserbase + Stagehand backend (planlanmış, implemente edilmemiş).
   - [x] Authentication: Session Handover / Token Injection (PAT mimarisi) ile Playwright context'ine token enjekte edildi. Single-use güvenlik modeli (okunduktan sonra veritabanından silinme) uygulandı.

2. **Customer-shared screen (mode B)**
   - [x] Detect the visitor's screen-share track in the room (`trackSubscribed` event var).
   - [x] Sample ~1 frame/sec via `VideoStream`, encode as JPEG data URL (`sharp` ile ARGB → JPEG, max 1024px wide).
   - [x] Expose as `read_customer_screen` tool; the agent decides when to look.
   - [x] Privacy: only sample while sharing; sampling stops and frame cleared on `track.ended`.

3. **Orchestration**
   - [x] `screenModes` array on the agent doc gates `tour` and `vision` tools — unauthorised calls return an error without executing.
   - [x] Record screen actions in `messages.meta` for the transcript timeline — `tour_started`, `navigate_to`, `highlight`, `vision_read` events saved to Message with `role:'system'`.

4. **Performance**
   - [x] Pool/limit concurrent tour browsers (global `activeBrowsers` Set ile max 3 tarayıcı limiti, `MAX_TOUR_BROWSERS` env var ile ayarlanabilir).
   - [x] Downscale frames before vision calls (müşteri ekranı 1024px wide JPEG'e indirgeniyor, tur kareleri 1280x720 normalize ediliyor).

---

## Acceptance criteria

- [x] Asking for a demo opens the product and the visitor sees navigation +
  highlights synced with narration.
- [x] Sharing a screen lets the agent describe what's on it and suggest the next
  action.
- [x] Both modes respect `agent.screenModes`. (`screenModes` gating eklendi).
- [x] Concurrency limits prevent runaway browser/vision cost. (MAX_TOUR_BROWSERS limiti eklendi).

---

## Risks

- **Headless browser scale** — memory/CPU heavy; pool + offload (Browserbase).
- **Vision cost on frames** — sample sparsely, downscale, only on demand.
- **Cross-origin/auth on the product** — Çözüm Planı: Frontend Widget üzerinden alınacak güvenli 'Oturum Token'ı (PAT mantığı), arka plandaki Playwright tarayıcısına (`browserContext.addCookies` / `evaluate`) enjekte edilecek.

---

## Security

`cobrowse.js`: `goto`/`click` are gated by an eTLD+1 allow-list built from
`Product.websiteUrl` + `tourAllowedDomains`, re-checked after navigation to
catch open-redirects. Double-open and orphaned-browser-on-failure leaks are
fixed; `goto`/`highlight` errors are caught instead of crashing.

`packages/contracts`: `ProductInput` rejects `file://`, private IPs, and
cloud metadata addresses (`169.254.169.254`) at the API boundary, so the
allow-list above is built from an already-safe root.

Known gaps: `open()`'s initial navigation isn't re-validated beyond what
`ProductInput` checked at creation · subresource requests from a trusted
page (e.g. an `<img>` pointed at a metadata IP) aren't blocked.
