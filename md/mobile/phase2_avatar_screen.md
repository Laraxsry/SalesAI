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
   - [x] `tavus`/`heygen`/`did`: subscribe to the avatar **video track** with
     `@livekit/react-native` and render full-bleed.
   - [x] `simli`/`voice-only`: draw a 2D orb/waveform from audio levels (Reanimated/Pulsing).
   - [x] Read provider config from the session response and pick the renderer.

2. **Captions**
   - [x] Consume `session:transcript` / LiveKit data messages; render rolling captions
     with speaker attribution; auto-scroll + tap-to-expand full transcript.

3. **Connection resilience**
   - [x] Handle reconnect, ICE restarts, and network transitions (wifi<->cellular).
   - [x] Pause/resume audio on background/foreground; keep-alive background audio mode for ongoing calls.
   - [x] Clear states for: mic blocked, link expired, agent paused, over quota.

4. **Screen intelligence (mobile-aware)**
   - [x] **Mode A (tour)**: render the agent-driven tour video track like any video —
     works fully on mobile.
   - [x] **Mode B (share)**: use LiveKit RN screen-share API where permitted; treat as best-effort and
     hide the control when unsupported.

5. **Controls & haptics**
   - [x] Large touch targets, haptic feedback, speaker/earpiece toggle, and an
     accessible end-call flow.

---

## Acceptance criteria

- [x] Each avatar provider renders correctly on iOS and Android.
- [x] Captions track the live conversation and can be expanded to full transcript.
- [x] Calls survive backgrounding and network switches, or reconnect gracefully.
- [x] The guided tour video renders; screen share works where the OS allows and is
  hidden where it does not.

---

## Risks

- **Background audio policies** — configure iOS background modes + Android
  foreground service correctly or calls drop when backgrounded.
- **Screen capture limits** — mobile OS restricts capture; keep mode B optional.
- **Avatar video perf** — watch battery/thermals; downscale when needed.
