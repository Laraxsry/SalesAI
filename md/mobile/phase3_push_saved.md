# Mobile — Phase 3: Push Notifications & Saved Conversations

> App: [`apps/mobile`](../../apps/mobile).
> Goal: let visitors keep a lightweight history and get re-engaged — save past
> conversations, resume them, and receive push notifications (follow-ups,
> agent availability, seller nudges).

---

## Scope

- Optional lightweight identity (device token or magic-link) to persist history.
- Saved conversations list + transcript/summary detail + resume.
- Push notifications (Expo Notifications) with deep links back into a session.
- Notification preferences and permission priming.

---

## Tasks

1. **Lightweight identity**
   - Anonymous device identity by default; optional email magic-link to sync
     history across devices (no full account required).
   - Store a `visitorId` and associate sessions to it (backend supports an
     optional visitor identity on `Session`).

2. **Saved conversations**
   - `Saved` screen lists past sessions with agent, product, date, and the
     auto-summary (from analytics Phase 4).
   - Detail view shows the full transcript; "Resume" opens a fresh session with
     the prior summary as context (agent greets with continuity).

3. **Push notifications** (`expo-notifications`)
   - Register the Expo push token; send to the API (`POST /devices`).
   - Notification types: follow-up from seller, "agent is available", saved-answer
     ready, demo reminder.
   - Deep-link payloads open `salesai://v/:token` or the saved conversation.

4. **Preferences & priming**
   - Pre-permission priming screen before the OS prompt; per-type toggles.
   - Respect quiet hours; unsubscribe handling.

---

## Data / API touchpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/devices` | Register Expo push token for a `visitorId` |
| `POST /api/v1/auth/magic-link` | Optional email link to sync history |
| `GET /api/v1/sessions/mine` | List a visitor's saved sessions |
| `POST /api/v1/notifications/send` | Seller/system-triggered push (server) |

---

## Acceptance criteria

- A visitor's past conversations appear in the Saved list with summaries.
- Resuming a conversation opens a session that has prior context.
- Push tokens register; a test push deep-links into the right screen.
- Notification preferences are respected, including opt-out.

---

## Risks

- **Privacy** — history is opt-in; make deletion easy; don't store PII without
  consent (aligns with backend Phase 8).
- **Push deliverability** — handle token refresh + invalid tokens.
- **Cross-device sync** — keep magic-link identity simple and revocable.
