# Backend — Phase 8: Security, Compliance & Production Scale

> Goal: ship a secure, compliant, horizontally-scalable production system —
> hardened auth, PII handling and data retention, audit logging, and a
> containerized deploy that autoscales the API, workers, and agent-worker.
> Outcome: SalesAI runs in production with CI/CD, secrets management, backups,
> and the controls needed for a security review.

---

## Scope

- Auth hardening (refresh rotation, sessions, optional 2FA, API keys).
- PII redaction + data retention + GDPR/CCPA data subject requests.
- Audit logging of privileged actions.
- Secrets management + rotation.
- Container images, CI/CD, autoscaling, backups, DR.

---

## Tasks

1. **Auth & access hardening** ([`@repo/auth`](../../packages/auth))
   - Refresh-token rotation + reuse detection; server-side session revocation.
   - Optional TOTP 2FA for seller accounts; login rate limiting + lockout.
   - Scoped **API keys** for programmatic access (`ApiKey` model, hashed at rest).
   - Strict CORS, HSTS, secure cookies, CSRF protection where cookies are used.

2. **PII & data retention**
   - Redact PII (emails, phone, cards) from transcripts/summaries before storage
     (regex + LLM classifier); store raw only when consented.
   - Configurable retention per workspace; TTL indexes purge expired
     `Session`/`Message`/frames; hard-delete on request.
   - `POST /privacy/export` (data export) and `POST /privacy/delete` (erasure)
     for data-subject requests; verify identity.

3. **Audit logging**
   - `AuditLog` records privileged actions (auth changes, member/role changes,
     agent activation, billing changes, data exports) with actor + IP + before/after.
   - Immutable append-only store; queryable by workspace admins.

4. **Secrets & config**
   - Load secrets from a manager (AWS Secrets Manager / Vault), not `.env`, in
     prod; support rotation without redeploy.
   - Encrypt provider keys and `toolAccess` credentials at rest (envelope encryption).

5. **Deploy & scale**
   - Dockerfiles per app; multi-stage builds; non-root images.
   - CI/CD (GitHub Actions): lint -> test -> build images -> push -> deploy.
   - Autoscale API + workers (HPA on CPU/queue depth); agent-worker scales on
     concurrent LiveKit rooms.
   - Socket.IO Redis adapter for multi-pod; sticky/least-conn as needed.
   - MongoDB Atlas backups + PITR; Redis persistence; object-storage lifecycle.
   - Blue/green or canary deploys; DB migrations gated in the pipeline.

6. **Security testing**
   - Dependency + container scanning (Snyk/Trivy) in CI.
   - Secret scanning + SAST; periodic pen-test checklist.
   - Rate limiting + WAF on public endpoints (`/sessions`, `/embed/*`).

---

## Data model additions

| Collection | Key fields |
|---|---|
| `ApiKey` | `workspaceId`, `name`, `hash`, `scopes[]`, `lastUsedAt`, `revokedAt` |
| `AuditLog` | `workspaceId`, `actorId`, `action`, `target`, `before/after`, `ip`, `at` |
| `AuthSession` | `userId`, `refreshTokenHash`, `device`, `revokedAt`, `expiresAt` |

---

## API additions

```
POST   /api/v1/auth/2fa/enable | /verify | /disable
POST   /api/v1/api-keys                    # create scoped key (shown once)
DELETE /api/v1/api-keys/:id
POST   /api/v1/privacy/export
POST   /api/v1/privacy/delete
GET    /api/v1/audit-logs                  # workspace admins
```

---

## Acceptance criteria

- Refresh-token reuse is detected and revokes the session family.
- Transcripts store redacted PII by default; retention TTL purges old data.
- Data export/erasure requests complete and are audit-logged.
- Privileged actions appear in the immutable `AuditLog`.
- CI builds and deploys images; API + workers autoscale under load.
- Backups restore cleanly in a DR drill.

---

## Risks

- **Over-redaction** — tune classifier; let workspaces opt into raw retention.
- **Migration safety** — expand/contract migrations; never destructive in one step.
- **Secret sprawl** — centralize in a manager; rotate; least-privilege IAM.
