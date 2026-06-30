# Web — Phase 1: Seller Console

> App: [`apps/console`](../../apps/console) (React 19 + Vite + Tailwind v4).
> Goal: sellers manage products, add knowledge of any modality, watch ingestion
> progress, and configure + activate agents.

---

## Scope

- Auth (login/register) + workspace context.
- Product CRUD.
- Knowledge manager: add text/URL/API, upload docs/images/video, live status.
- Agent builder: persona, avatar provider, screen modes, tool access.
- Activate -> show share link + embed snippet.

---

## Routes

| Route | Purpose |
|---|---|
| `/login`, `/register` | Auth |
| `/` | Overview: products, recent sessions, KPIs |
| `/products/:id` | Product detail |
| `/knowledge` | Sources list + add/upload + ingestion status |
| `/agents` | Agents list |
| `/agents/:id` | Agent builder + activation |
| `/agents/:id/sessions` | Transcripts + analytics |

---

## Key UX

- **Knowledge manager**
  - Drag-and-drop upload (presigned S3); per-source status chips
    (`pending -> processing -> ready/failed`) updated live via Socket.IO
    (`ingestion:progress`, `ingestion:ready`).
  - "Add live software": enter the product URL (+ optional OpenAPI/MCP) to enable
    crawling and live tool access.

- **Agent builder**
  - Persona form (tone, language, goals, guardrails).
  - Avatar provider selector (developer/admin choice) with a preview.
  - Screen-mode toggles (guided tour / customer share).
  - Activate button -> modal with the share link + copy-paste embed snippet.

---

## Tech

- State: Zustand (UI) + React Query (server state).
- Forms: React Hook Form + Zod (`@repo/contracts`).
- Components: `@repo/ui` + Tailwind v4 (`@repo/tailwind-config`).
- Realtime: Socket.IO client subscribed to ingestion + session events.

---

## Acceptance criteria

- Add every source type and see status reach `ready` live.
- Build and activate an agent; copy a working share link.
- See live transcripts stream in for an active session.
