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
   - `GuidedTour.open({ startUrl })` launches a headless Chromium of the product.
   - Tool handlers: `start_guided_tour`, `navigate_to`, `highlight`.
   - Publish frames into LiveKit as a video track (screenshot loop or CDP
     screencast) so the visitor sees the live UI alongside the avatar.
   - Optional Browserbase + Stagehand backend for cloud browser + computer-use
     ("go to billing and add a seat") driven by natural language.
   - Authentication: support a seller-provided demo account / session for the
     product so the tour shows real screens.

2. **Customer-shared screen (mode B)**
   - Detect the visitor's screen-share track in the room.
   - Sample ~1 frame/sec, encode as data URL, call `analyzeFrame()`.
   - Expose as `read_customer_screen` tool; the agent decides when to look.
   - Privacy: only sample while sharing; never persist frames by default.

3. **Orchestration**
   - The agent chooses the mode based on intent; `screenModes` gates what's
     allowed per agent.
   - Record screen actions in `messages.meta` for the transcript timeline.

4. **Performance**
   - Pool/limit concurrent tour browsers; reuse contexts; cap frame rate.
   - Downscale frames before vision calls to control token cost.

---

## Acceptance criteria

- Asking for a demo opens the product and the visitor sees navigation +
  highlights synced with narration.
- Sharing a screen lets the agent describe what's on it and suggest the next
  action.
- Both modes respect `agent.screenModes`.
- Concurrency limits prevent runaway browser/vision cost.

---

## Risks

- **Headless browser scale** — memory/CPU heavy; pool + offload (Browserbase).
- **Vision cost on frames** — sample sparsely, downscale, only on demand.
- **Cross-origin/auth on the product** — needs a demo session strategy.
