# Backend — Phase 6: Team, Billing & Quotas

> Goal: make SalesAI a real multi-tenant SaaS — invite teammates with roles,
> subscribe to a plan, meter usage (agent minutes, ingestion, avatar seconds),
> and enforce quotas that map directly to cost drivers.
> Outcome: a workspace can invite members, pick a plan, and be blocked (gracefully)
> when it exceeds its quota; usage and invoices are visible via the API.

---

## Scope

- [x] `Invitation`, `Subscription`, `UsageRecord`, `Plan` models.
- [x] Team management: invite/accept, role changes, remove members.
- [x] Stripe integration: checkout, customer portal, webhooks.
- [x] Usage metering for the real cost drivers + quota enforcement middleware.
- [x] Billing-aware feature gates (avatar tiers, screen intelligence, seats).


---

## Tasks

1. **Team management** (builds on `@repo/access` RBAC)
   - [x] `POST /workspaces/:id/invitations` emails a signed invite token.
   - [x] `POST /invitations/:token/accept` creates a `Membership` with the role.
   - [x] `PATCH /memberships/:id` (role change), `DELETE /memberships/:id`.
   - [x] Guard with `requirePermission('member:manage')`; owners cannot be removed.

2. **Plans & subscriptions**
   - [x] Define `Plan`s (Free/Pro/Scale) with quotas + allowed features.
   - [x] `POST /billing/checkout` -> Stripe Checkout Session for a plan.
   - [x] `POST /billing/portal` -> Stripe customer portal link.
   - [x] `POST /billing/webhook` handles `checkout.completed`,
     `subscription.updated/deleted`, `invoice.paid/failed`; keep `Subscription`
     in sync (status, plan, current period, cancelAt).

3. **Usage metering** ([`@repo/queue`](../../packages/queue) + workers)
   - [x] Meter: agent voice minutes, avatar seconds (by provider), ingestion units
     (transcription minutes, pages crawled, embeddings), tour browser minutes,
     vision frames.
   - [x] Write `UsageRecord`s from the agent-worker + ingestion worker; aggregate per
     billing period into the `Subscription`.
   - [x] `GET /billing/usage` returns current-period usage vs. quota per meter.

4. **Quota enforcement**
   - [x] `enforceQuota(meter)` middleware / guard: soft-warn at 80%, hard-block at
     100% for gated actions (start session, add knowledge, use premium avatar).
   - [x] Return `402 Payment Required` with the meter + upgrade hint; agent-worker
     refuses/ends sessions cleanly when the workspace is over quota.

5. **Feature gates**
   - [x] Map plan -> allowed `avatarProvider`s, `screenModes`, seat count, embed
     domains, and API access; validate on agent activation and session start.

6. **Cost accounting**
   - [x] Tag each `UsageRecord` with an estimated cost so analytics can show
     margin per agent/session (ties into Phase 4 + Phase 7 cost tracking).

---

## Data model additions

| Collection | Key fields |
|---|---|
| `Plan` | `key`, `name`, `stripePriceId`, `quotas{}`, `features{}` |
| `Subscription` | `workspaceId`, `planKey`, `stripeCustomerId`, `stripeSubId`, `status`, `periodStart/End`, `usage{}` |
| `Invitation` | `workspaceId`, `email`, `role`, `token`, `status`, `expiresAt` |
| `UsageRecord` | `workspaceId`, `meter`, `quantity`, `estCost`, `sessionId?`, `at` |

---

## API additions

```
POST   /api/v1/workspaces/:id/invitations
POST   /api/v1/invitations/:token/accept
PATCH  /api/v1/memberships/:id
DELETE /api/v1/memberships/:id
POST   /api/v1/billing/checkout
POST   /api/v1/billing/portal
POST   /api/v1/billing/webhook            # Stripe (raw body, signature verified)
GET    /api/v1/billing/usage
```

---

## Acceptance criteria

- [x] Invite a teammate; they accept and get the assigned role.
- [x] Subscribing via Checkout activates the plan; webhook updates `Subscription`.
- [x] Voice minutes and avatar seconds accrue as `UsageRecord`s during a session.
- [x] Exceeding a hard quota blocks the gated action with a `402` + upgrade path.
- [x] Downgrading a plan disables features not allowed on the lower tier.

---

## Risks

- **Webhook reliability** — verify signatures, make handlers idempotent, retry.
- **Usage double-counting** — meter from a single authoritative point per meter.
- **Race at quota edge** — reserve/commit pattern for session starts.
