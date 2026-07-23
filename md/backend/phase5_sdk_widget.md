# Backend — Phase 5: Embeddable SDK & Widget

> Goal: let sellers drop the AI rep onto their own site with a single snippet.
> The backend issues scoped embed tokens, enforces domain allowlists, and serves
> widget config so the visitor experience runs inside an iframe on any origin.
> Outcome: paste a `<script>` snippet and a floating "Talk to sales" bubble opens
> a real session on the seller's domain.

---

## Scope

- `EmbedConfig` + `EmbedDomain` models (per agent widget settings + allowlist).
- Public widget config endpoint + short-lived embed session tokens.
- CORS / origin verification for embedded contexts.
- `@repo/sdk` loader script and iframe bootstrap contract.
- Bot/abuse protection for public embed traffic.

---

## Tasks

1. [x] **Widget configuration**
   - [x] `POST /agents/:id/embed` saves an `EmbedConfig`: theme, launcher position,
     greeting, allowed domains, rate caps, and whether mic auto-prompts.
   - [x] `GET /embed/:token/config` (public) returns non-secret render config for the
     loader, validated against the requesting `Origin`/`Referer`.

2. [x] **Embed session tokens**
   - [x] `POST /embed/:token/session` mints a session exactly like `POST /sessions`
     but verifies the origin is in `EmbedDomain` and applies embed rate limits.
     (Reuses the existing `ShareLink` token rather than a separate embed token.)
   - [x] Return `{ roomName, token, livekitUrl, config }`.

3. [x] **Loader script** ([`@repo/sdk`](../../packages/sdk))
   - [x] Ship `salesai.js` (built to `sdk/dist`) served from a CDN route
     (`GET /sdk/salesai.js`) with long cache + versioned URL.
   - [x] The loader injects a launcher button and an iframe pointing at the visitor
     app in `?embed=1` mode with the embed token.

4. [x] **Origin & CORS enforcement**
   - [x] Middleware resolves the agent from the embed token, checks the `Origin`
     against `EmbedDomain`, and sets per-origin CORS headers.
   - [x] Wildcard subdomains supported (`*.acme.com`); localhost allowed in dev only.

5. **Abuse protection**
   - [x] Per-IP + per-origin rate limiting (Redis token bucket).
   - [ ] Optional hCaptcha/Turnstile challenge before session creation for
     high-traffic embeds; bot heuristics on session start. (bot heuristics done —
     `apps/api/src/middleware/bot-heuristics.js`; captcha deferred until web Phase 6)

6. [x] **Analytics attribution**
   - [x] Tag embed sessions with `source: 'widget'`, `pageUrl`, and referrer so
     Phase 4 analytics can segment web vs. widget traffic.

---

## Data model additions

| Collection | Key fields |
|---|---|
| `EmbedConfig` | `agentId`, `theme{}`, `launcher{}`, `greeting`, `micAutoPrompt`, `rateCaps{}` |
| `EmbedDomain` | `agentId`, `domain` (supports `*.` wildcard), `verified`, `verifiedAt` |

---

## API additions

```
POST   /api/v1/agents/:id/embed          # save embed config + domains (auth)
GET    /api/v1/embed/:token/config        # public render config (origin-checked)
POST   /api/v1/embed/:token/session       # public embed session (origin + rate limited)
GET    /sdk/salesai.js                     # versioned loader script (CDN-cached)
```

---

## Acceptance criteria

- [x] A snippet on an allowlisted domain opens the widget and starts a session.
- [x] Requests from a non-allowlisted origin are rejected with a clear error.
- [x] The loader is versioned and cached; upgrading the version invalidates cache.
- [x] Embed sessions are rate-limited and tagged `source: widget` in analytics.
- [ ] `?embed=1` visitor UI renders cleanly inside the iframe (see web Phase 6).

---

## Risks

- **Origin spoofing** — treat `Origin` as advisory; combine with signed token +
  rate limits; never expose secrets in public config.
- **Third-party CSP** — document the CSP directives host sites must allow.
- **Cache poisoning** — version the loader URL; immutable cache headers.
