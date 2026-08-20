# Mobile — Phase 4: Seller Console-Lite

> App: [`apps/mobile`](../../apps/mobile).
> Goal: give sellers an on-the-go companion — sign in, watch live sessions,
> read transcripts and analytics, manage leads, and get alerted to activity.
> A focused subset of the web console (web Phases 1, 4, 5), not the full builder.

---

## Scope

- Seller auth + workspace switcher (reuses backend auth + RBAC).
- Live sessions monitor with real-time transcript.
- Analytics summary (KPIs + trends) read-only.
- Leads inbox with status updates.
- Push alerts for new sessions/leads (ties into Phase 3).

---

## Navigation

| Tab / screen | Purpose |
|---|---|
| `Home` | KPIs, live/active sessions, recent activity |
| `Sessions` | List + live transcript view + post-call summary |
| `Leads` | Leads inbox; update status; tap-to-contact |
| `Agents` | Read-only agent list + pause/resume toggle |
| `Settings` | Account, workspace switch, notifications, sign out |

---

## Tasks

1. **Auth & workspace context**
   - [x] Login/refresh against `@repo/auth`; secure token storage (SecureStore).
   - [x] Workspace switcher; RBAC gates what's visible per role.

2. **Live sessions**
   - [x] Subscribe to Socket.IO (`session:started/transcript/ended/summary`).
   - [x] Live session list with a real-time transcript view; post-call summary.

3. **Analytics (read-only)**
   - [x] KPI cards + simple trend charts from the analytics API (Phase 4 backend);
     date-range filter.

4. **Leads**
   - [x] Leads inbox sorted by score; update status; quick actions (email/call intent).

5. **Lightweight agent control**
   - [x] Pause/resume an agent (not the full builder); confirm destructive actions.

6. **Alerts**
   - [x] Push on new session/lead/handoff request (reuses Phase 3 push plumbing).

---

## Acceptance criteria

- [x] A seller signs in, switches workspaces, and sees KPIs + active sessions.
- [x] Live transcripts stream into the app during an active session.
- [x] Leads can be viewed and their status updated from mobile.
- [x] An agent can be paused/resumed from the app.
- [x] Role permissions gate visible actions (viewer vs. admin/owner).

---

## Risks

- **Scope creep** — keep it a companion; the full builder stays on web.
- **Realtime battery cost** — throttle updates; disconnect when backgrounded.
- **Token security** — use SecureStore; handle refresh + revocation.
