# Mobile — Phase 2: Avatar, Captions & Screen

> App: [`apps/mobile`](../../apps/mobile) (Expo + Expo Router + LiveKit RN).
> Goal: bring the mobile visitor experience to parity with web — per-provider
> avatar rendering, live captions, robust reconnection, and best-effort screen
> intelligence within OS limits.

---

## Scope

- Avatar rendering per provider on native (video track vs. client-drawn).
- Live captions from the transcript data channel.
- Connection lifecycle: reconnect, background/foreground, network changes.
- Screen intelligence within mobile OS constraints (view tour; share where allowed).
- In-call controls tuned for touch.

---

## Screens & components

| Screen / component | Purpose |
|---|---|
| `v/[token]` | Join room, render avatar + audio, captions, controls |
| `AvatarView` | Renders the agent per `avatarProvider` |
| `Captions` | Live transcript overlay from data messages |
| `CallControls` | Mute, speaker, share (if allowed), end |

---

## Tasks

1. **Avatar rendering**
   - `tavus`/`heygen`/`did`: subscribe to the avatar **video track** with
     `@livekit/react-native` and render full-bleed.
   - `simli`/`voice-only`: draw a 2D orb/waveform from audio levels (Skia/Reanimated).
   - Read provider config from the session response and pick the renderer.

2. **Captions**
   - Consume `session:transcript` / LiveKit data messages; render rolling captions
     with speaker attribution; auto-scroll + tap-to-expand full transcript.

3. **Connection resilience**
   - Handle reconnect, ICE restarts, and network transitions (wifi<->cellular).
   - Pause/resume audio on background/foreground; keep-alive foreground service
     (Android) + background audio mode (iOS) for ongoing calls.
   - Clear states for: mic blocked, link expired, agent paused, over quota.

4. **Screen intelligence (mobile-aware)**
   - **Mode A (tour)**: render the agent-driven tour video track like any video —
     works fully on mobile.
   - **Mode B (share)**: use `ReplayKit` (iOS) / `MediaProjection` (Android) via
     the LiveKit RN screen-share API where permitted; treat as best-effort and
     hide the control when unsupported.

5. **Controls & haptics**
   - Large touch targets, haptic feedback, speaker/earpiece toggle, and an
     accessible end-call flow.

---

## Acceptance criteria

- Each avatar provider renders correctly on iOS and Android.
- Captions track the live conversation and can be expanded to full transcript.
- Calls survive backgrounding and network switches, or reconnect gracefully.
- The guided tour video renders; screen share works where the OS allows and is
  hidden where it does not.

---

## Risks

- **Background audio policies** — configure iOS background modes + Android
  foreground service correctly or calls drop when backgrounded.
- **Screen capture limits** — mobile OS restricts capture; keep mode B optional.
- **Avatar video perf** — watch battery/thermals; downscale when needed.
