# Web — Phase 5: Team & Billing (Console)

> App: [`apps/console`](../../apps/console).
> Goal: workspace settings where owners manage members and roles, subscribe to a
> plan, watch usage against quota, and handle invoices — backed by backend Phase 6.

---

## Scope

- Workspace settings shell (profile, members, billing, API keys, danger zone).
- Member management: invite, accept, change role, remove.
- Plan selection + Stripe Checkout / customer portal.
- Usage meters vs. quota with upgrade prompts.
- Feature gating in the UI based on the active plan.

---

## Routes

| Route | Purpose |
|---|---|
| `/settings` | Workspace profile (name, slug, timezone, logo) |
| `/settings/members` | Members list, invite, roles, remove |
| `/settings/billing` | Plan, usage, invoices, upgrade/downgrade |
| `/settings/api-keys` | Create/revoke scoped API keys |
| `/invite/:token` | Accept-invite landing (auth + join workspace) |

---

## Key UX

- **Members**: table with role badges (`OWNER/ADMIN/EDITOR/VIEWER`); invite modal
  (email + role) that shows pending invites; inline role edit; remove with
  confirm (owner protected).
- **Billing**: current plan card, "Upgrade" -> Stripe Checkout, "Manage" ->
  customer portal; usage bars per meter (voice minutes, avatar seconds,
  ingestion units, tour minutes) with 80% warn / 100% block states.
- **Feature gates**: premium avatar providers, screen intelligence, extra seats,
  and embed domains are visibly locked with an "Upgrade to unlock" affordance
  driven by the plan's `features{}`.
- **API keys**: create (secret shown once, copy), list with `lastUsedAt`, revoke.

---

## Tech

- RBAC-aware UI: hide/disable actions per `req.member` role from `@repo/access`.
- Stripe redirect flows (Checkout + portal) with success/cancel return routes.
- React Query invalidation on billing webhook-driven `subscription` changes
  (poll or Socket.IO `billing:updated`).

---

## Acceptance criteria

- An owner invites a member who accepts via `/invite/:token` and lands in the
  workspace with the right role.
- Upgrading opens Checkout; on return, the plan and unlocked features update.
- Usage bars reflect real metered usage and warn/block at thresholds.
- A viewer cannot see or trigger admin/owner-only actions.
- API keys can be created (shown once) and revoked.

---

## Risks

- **Role escalation in UI** — always enforce on the server; UI gating is cosmetic.
- **Billing state lag** — reconcile after returning from Stripe; show pending.
- **Seat over-invite** — validate seat quota before sending invites.
