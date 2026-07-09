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
   - [ ] Publish frames into LiveKit as a video track (sadece screenshot alınıyor, LiveKit'e publish stublandı; gerçek `publishTrack()` implemente edilmemiş).
   - [ ] Optional Browserbase + Stagehand backend (planlanmış, implemente edilmemiş).
   - [ ] Authentication: demo account / session desteği yok.

2. **Customer-shared screen (mode B)**
   - [x] Detect the visitor's screen-share track in the room (`trackSubscribed` event var).
   - [ ] Sample ~1 frame/sec, encode as data URL (gerçek frame örneklemesi stublandı; sabit stub base64 döndürülüyor).
   - [x] Expose as `read_customer_screen` tool; the agent decides when to look.
   - [ ] Privacy: only sample while sharing; never persist frames (kural var ama gerçek sampling olmadığı için anlamsız).

3. **Orchestration**
   - [ ] The agent chooses the mode based on intent; `screenModes` gates what's
     allowed per agent. (`screenModes` kontrolü agent-worker'da uygulanmamış).
   - [ ] Record screen actions in `messages.meta` for the transcript timeline. (mesaj meta’ya yazılmıyor).

4. **Performance**
   - [ ] Pool/limit concurrent tour browsers; reuse contexts; cap frame rate. (pool mekanizması yok).
   - [ ] Downscale frames before vision calls to control token cost. (downscaling yok).

---

## Acceptance criteria

- [ ] Asking for a demo opens the product and the visitor sees navigation +
  highlights synced with narration. (LiveKit video track publish eksik).
- [ ] Sharing a screen lets the agent describe what's on it and suggest the next
  action. (gerçek frame örneklemesi stub, gerçek bir analiz yapılamıyor).
- [ ] Both modes respect `agent.screenModes`. (`screenModes` kontrolü yok).
- [ ] Concurrency limits prevent runaway browser/vision cost. (limit yok).

---

## Risks

- **Headless browser scale** — memory/CPU heavy; pool + offload (Browserbase).
- **Vision cost on frames** — sample sparsely, downscale, only on demand.
- **Cross-origin/auth on the product** — needs a demo session strategy.
