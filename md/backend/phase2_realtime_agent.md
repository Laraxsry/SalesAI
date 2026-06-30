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
   - `POST /agents` validates with `AgentConfigInput`; choose `avatarProvider`,
     `screenModes`, persona, optional `toolAccess`.
   - `POST /agents/:id/activate` sets `status: active`, mints a `ShareLink`,
     returns the public URL + embed snippet
     ([`routes/agents.js`](../../apps/api/src/routes/agents.js)).

2. **Session creation**
   - `POST /sessions` resolves the share token, creates a `Session` + LiveKit
     room name, and returns `{ roomName, token, livekitUrl }`
     ([`routes/sessions.js`](../../apps/api/src/routes/sessions.js)).
   - Enforce `active`, `expiresAt`, `maxSessions`.

3. **Agent worker** ([`agent-worker`](../../apps/agent-worker))
   - `defineAgent` entry: `connectDB`, load `Session`->`Agent`->`Product`.
   - `buildSystemPrompt()` + `buildTools()` from `@repo/agent`.
   - `voice.AgentSession` with OpenAI Realtime (`gpt-realtime-2`); VAD,
     interruption, tool calls.
   - Attach avatar via `getAvatarProvider(agent.avatarProvider)`.
   - Persist transcript turns to `messages`; emit `session:transcript`.

4. **Avatar providers** ([`@repo/avatar`](../../packages/avatar))
   - Start with `voice-only` (always works) + `tavus` (server-rendered video).
   - `simli`/`heygen`/`did` wired but gated by env keys.

5. **Worker dispatch**
   - Configure LiveKit to dispatch `agent-worker` on room creation (agent name)
     so the brain joins automatically when a visitor connects.

6. **Resilience**
   - Avatar attach failure -> fall back to voice-only (already handled).
   - Session timeouts + cleanup via `worker-general`.

---

## Acceptance criteria

- Activating an agent returns a working `/v/:token` link.
- Opening the link starts a session, the agent joins, and voice works two-way.
- With `AVATAR_PROVIDER=tavus` (+ keys), a talking face video appears.
- Answers are grounded (agent calls `search_knowledge`).
- Transcripts are stored per turn.

---

## Risks

- **Realtime cost** — trim context, cache, consider mini realtime model.
- **Avatar provider quotas/latency** — per-agent selection lets us tune.
- **Node plugin coverage** — Tavus has a Node plugin; Simli is client-driven;
  HeyGen/D-ID are bridged. Document per-provider wiring.
