# Backend — Phase 0: Foundation

> Goal: a running monorepo with infra, database, auth, and the API skeleton.
> Outcome: `npm run dev` boots the API; health check passes; a user can register
> and log in.

---

## Scope

- Monorepo wiring (Turborepo, npm workspaces, ESLint, Prettier).
- Local infra via Docker (MongoDB Atlas Local, Redis, MinIO, Qdrant, LiveKit).
- `@repo/database` connection + base models.
- `@repo/auth` (JWT + bcrypt) and `@repo/access` (RBAC).
- `apps/api` skeleton: middleware chain, health, auth routes.

---

## Tasks

1. **Infra up**
   - [x] `npm run infra:up` starts containers from
     [`infra/docker-compose.yaml`](../../infra/docker-compose.yaml).
   - [x] Verify MongoDB Vector Search is available (Atlas Local image).

2. **Env**
   - [x] `cp .env.example .env`; set `MONGODB_URI`, `REDIS_URL`, `JWT_*`,
     `LIVEKIT_*`, `OPENAI_API_KEY`.
   - [x] Validate at boot with `@repo/config-env` (`loadEnv`).

3. **Database**
   - [x] `connectDB()` on API start ([`apps/api/src/main.js`](../../apps/api/src/main.js)).
   - [x] Models: `User`, `Workspace`, `Membership` (others land in later phases).

4. **Auth**
   - [x] `POST /auth/register` -> hash password, create user + personal workspace +
     OWNER membership.
   - [x] `POST /auth/login` -> verify, `signTokens()`.
   - [x] `POST /auth/refresh`, `POST /auth/logout`.
   - [x] `requireAuth` middleware guards protected routes.

5. **RBAC**
   - [x] Resolve `req.member` (workspace role) in a tenant middleware.
   - [x] `requirePermission('product:read')` etc.

6. **Quality gates**
   - [x] `npm run lint`, `npm run test` wired through Turbo.
   - [x] GitHub Actions: install -> lint -> test -> build.

---

## Acceptance criteria

- [x] `GET /health` returns `{ ok: true }`.
- [x] Register + login returns valid access/refresh tokens.
- [x] A protected route returns 401 without a token, 200 with one.
- [x] CI is green.

---

## Notes / decisions

- JS + JSDoc + ESM throughout; types are advisory via the shared tsconfig.
- One personal workspace is created per user at registration so products always
  have a tenant.
