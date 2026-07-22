# Backend — Phase 8: Security, Compliance & Production Scale

> Goal: ship a secure, compliant, horizontally-scalable production system —
> hardened auth, PII handling and data retention, audit logging, and a
> containerized deploy that autoscales the API, workers, and agent-worker.
> Outcome: SalesAI runs in production with CI/CD, secrets management, backups,
> and the controls needed for a security review.

---

## Scope

- Auth hardening (refresh rotation, server-side sessions, optional 2FA, API keys).
- PII redaction + data retention + GDPR/CCPA data subject requests.
- Audit logging of privileged actions (immutable, append-only).
- Secrets management + rotation (AWS Secrets Manager / Vault).
- Container images, CI/CD pipeline, autoscaling, backups, DR.
- Security testing (dependency scanning, SAST, pen-test checklist).

---

## Tasks

1. **Auth & access hardening** ([`@repo/auth`](../../packages/auth))

   - [x] **`AuthSession` modeli**: `userId`, `refreshTokenHash`, `device`, `ip`, `revokedAt`,
     `expiresAt` alanlarıyla `packages/database/src/models/AuthSession.js` oluştur.
     Her login'de DB'ye kaydedilir; revoke işlemi sadece bu kaydı günceller.
     > **Neden:** Mevcut `/auth/refresh` stateless JWT kullanıyor — token çalınsa
     > sunucu tarafında iptal etmek mümkün değil. Server-side session bu açığı kapatır.

   - [x] **Refresh-token rotation + reuse detection**: `POST /auth/refresh`'i `AuthSession`'a
     bağla. Her refresh işleminde eski hash revoke edilir, yeni hash yazılır. Eğer
     aynı refresh token iki kez kullanılırsa (`reuseDetected`), tüm session ailesi
     hemen iptal edilir ve kritik güvenlik uyarısı loglanır.
     > **Neden:** Token reuse, token çalındığının kanıtıdır (Refresh Token Rotation best practice).

   - [x] **Server-side session revocation**: `POST /auth/logout`'a `AuthSession.revokedAt`
     yazma ekle. `requireAuth` middleware'ini, access token geçerli olsa bile ilgili
     session revoke edilmişse 401 döndürecek şekilde güncelle.
     > **Neden:** Şu an logout sadece client'a "token'ı sil" diyor; server hiçbir şey
     > yapmıyor. Çalınan token logout sonrasında da geçerli olabiliyor.

   - [x] **Login rate limiting + lockout**: `POST /auth/login` ve `POST /auth/register`
     endpoint'lerine Redis tabanlı rate limiter ekle (`express-rate-limit` +
     `rate-limit-redis`). 5 başarısız giriş → 15 dakika lockout; lockout durumunda
     `AuditLog`'a yaz.
     > **Neden:** Brute-force ve credential stuffing saldırılarına karşı temel koruma.

   - [x] **Scoped API keys** (`ApiKey` modeli): `workspaceId`, `name`, `keyHash`
     (SHA-256), `scopes[]`, `prefix` (görüntüleme için ilk 8 karakter), `lastUsedAt`,
     `revokedAt` alanlarıyla model oluştur.
     `POST /api-keys` → key bir kez plain text gösterilir, hash'i saklanır.
     `DELETE /api-keys/:id` → revoke.
     `requireAuth` middleware'ini Bearer token API key de olabilecek şekilde genişlet
     (prefix kontrolü ile hızlı ayırt etme).
     > **Neden:** CI/CD, mobile app veya üçüncü parti entegrasyonlar JWT refresh
     > döngüsüne girmeden API'ya erişmeli.

   - [x] **Strict security headers**: `main.js`'teki `helmet()` konfigürasyonunu
     şunları içerecek şekilde güncelle: HSTS (`max-age=31536000; includeSubDomains`),
     `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
     `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
     CORS origin listesini `CORS_ORIGIN` env'den alınan allowlist ile kısıtla (wildcard `*` yasak).
     > **Neden:** Mevcut `helmet()` default ayarlarla çalışıyor; bazı başlıklar eksik veya zayıf.

   - [x] **Optional TOTP 2FA** (seller hesapları için):
     `POST /auth/2fa/enable` → secret üretir, QR code base64 döner (henüz aktif değil).
     `POST /auth/2fa/verify` → TOTP kodunu doğrular, 2FA'yı aktif eder; `User` modeline
     `twoFactorSecret` ve `twoFactorEnabled` alanı ekle.
     `POST /auth/2fa/disable` → şifre re-doğrulamasıyla 2FA'yı devre dışı bırakır.
     Login akışı: 2FA aktif kullanıcılarda `accessToken` yerine `mfaToken` (kısa süreli)
     döndür; `/auth/2fa/verify` ile exchange'den sonra tam token verilir.
     > **Neden:** Seller hesapları yüksek değerli — yetkisiz erişim tüm visitor
     > deneyimini etkiler. 2FA bu riski önemli ölçüde azaltır.

   **Acceptance criteria (Task 1):**
   - [x] Refresh token reuse algılandığında tüm session ailesi iptal edilir.
   - [x] Logout sonrası refresh token geçersiz hale gelir (DB kontrolü).
   - [x] 5 başarısız login → 15 dk lockout; `AuditLog`'a yazılır.
   - [x] `POST /api-keys` key'i bir kez plain text döndürür; sonraki isteklerde prefix+hash görünür.
   - [x] 2FA aktif hesapta login, TOTP olmadan tam token vermez.

---

2. **PII & data retention** ([`apps/worker-general`](../../apps/worker-general))

   - [x] **PII redactor utility** (`packages/utils/src/pii-redactor.js`): email, telefon,
     kredi kartı numaraları için regex tabanlı pattern'ler; `redactPII(text)` fonksiyonu
     döndürür. Hassas pattern eşleştiğinde `[REDACTED]` ile değiştirir.
     > **Neden:** Transcript'ler LLM'den geçiyor ve DB'ye yazılıyor. GDPR/CCPA
     > uyumu için PII varsayılan olarak saklanmamalı.

   - [x] **Transcript PII redaction**: `apps/agent-worker` içinde her `Message` kaydedilmeden
     önce `redactPII()` uygula. `Agent` modeline `rawTranscriptEnabled` boolean alanı ekle
     (workspace OWNER/ADMIN onayı gerekli, varsayılan `false`). `rawTranscriptEnabled:true`
     ise ham metin saklanır, `false` ise redact edilmiş hali saklanır.
     > **Neden:** Hassas müşteri verilerinin sızıntısını iş seviyesinde kontrol altına alır.

   - [x] **Configurable retention TTL + purge job**: `Workspace` modeline
     `retentionDays` alanı ekle (varsayılan 365). `worker-general`'a
     `purge-expired-data` cron job ekle (günlük gece yarısı): `retentionDays` geçmiş
     `Session`, `Message`, `SessionEvent`, `SessionSummary` dökümanlarını sil.
     `AuditLog` tutulacak minimum süreyi env ile ayarlanabilir tut (`AUDIT_LOG_RETENTION_DAYS`).
     > **Neden:** GDPR madde 5(1)(e) — veriler ihtiyaç duyulduğu süre kadar saklanmalı.

   - [x] **Privacy endpoints**:
     `POST /privacy/export` → caller'ın workspace'indeki tüm Session, Message, Lead
     verilerini JSON olarak toplar, S3'e yazar, signed download URL döner. İşlem
     `AuditLog`'a kaydedilir.
     `POST /privacy/delete` → caller'ın verilerini kalıcı olarak siler (hard delete);
     işlem tamamlanmadan önce aktif live session varsa 409 Guard; `AuditLog`'a kaydedilir.
     > **Neden:** GDPR'ın "veri taşınabilirliği" (madde 20) ve "silinme hakkı"
     > (madde 17) zorunlu endpoint'leri.

   **Acceptance criteria (Task 2):**
   - [x] Redact varsayılan — bir `Message` kaydedildiğinde email/telefon `[REDACTED]` görünür.
   - [x] `rawTranscriptEnabled:true` olan workspace'de ham metin korunur.
   - [x] `purge-expired-data` job'ı `retentionDays` süresi geçmiş veriyorları siler.
   - [x] `POST /privacy/export` → geçerli JSON, S3'ten indirilebilir URL.
   - [x] `POST /privacy/delete` → veri silinir + `AuditLog`'a yazılır.

---

3. **Audit logging** ([`@repo/database`](../../packages/database) + [`apps/api`](../../apps/api))

   - [x] **`AuditLog` modeli** (`packages/database/src/models/AuditLog.js`):
     `workspaceId`, `actorId` (userId veya apiKeyId), `actorType` (`user|api-key`),
     `action` (string enum), `target` (`{ type, id }`), `before` (JSON), `after` (JSON),
     `ip`, `userAgent`, `at` (timestamp). Schema seviyesinde immutable: `{ strict: false }`
     ve hiçbir update/delete index'i olmadan sadece `insertOne` ile yazılır.
     > **Neden:** Immutable audit trail olmadan privileged işlemleri takip etmek imkansız.
     > Yasal uyumluluk ve iç güvenlik denetimleri için zorunlu.

   - [x] **`logAudit()` helper** (`packages/utils/src/audit.js`): `AuditLog.create()` wrap'i;
     tüm privileged action'larda kolayca çağrılabilir. `action` enum'ı tanımla:
     `auth.login`, `auth.logout`, `auth.refresh_reuse`, `auth.2fa_enabled`,
     `auth.lockout`, `member.invited`, `member.role_changed`, `member.removed`,
     `agent.activated`, `agent.paused`, `agent.deleted`, `billing.plan_changed`,
     `apikey.created`, `apikey.revoked`, `privacy.export`, `privacy.delete`,
     `data.purge`.
     > **Neden:** Merkezi helper, action'ların tutarsız formatlanmasını önler.

   - [x] **Audit log'u privileged action'lara ekle**: Auth, agents, products, sessions,
     analytics rotalarındaki kritik mutation'lara `logAudit()` çağrısı ekle
     (activate/pause/delete agent, member invite/role/remove, login/logout, API key create/revoke).
     > **Neden:** Log olmazsa denetim yapılamaz.

   - [x] **`GET /audit-logs` endpoint**: Workspace admin ve owner'lar için;
     `action`, `actorId`, `from`, `to` filtreleri; sayfalı response (cursor pagination).
     `requirePermission('audit:read')` ile guard et.
     > **Neden:** Workspace yöneticilerinin güvenlik olaylarını görüp inceleyebilmesi.

   **Acceptance criteria (Task 3):**
   - [x] Agent activate/pause/delete işlemleri `AuditLog`'a yazar.
   - [x] Member invite/role-change/remove işlemleri `AuditLog`'a yazar.
   - [x] `GET /audit-logs` workspace admin'e filtrelenmiş sayfalı log döner.
   - [x] `AuditLog` koleksiyonuna hiçbir update/delete işlemi uygulanamaz (immutability test).

---

4. **Secrets & config** ([`@repo/config-env`](../../packages/config-env))

   - [x] **Secrets manager entegrasyonu**: `@repo/config-env/load` içine ortama göre
     (`NODE_ENV=production`) AWS Secrets Manager veya HashiCorp Vault'tan secret çeken
     loader ekle. `SECRETS_BACKEND=aws|vault|env` env değişkeniyle seçilebilir.
     Dev ortamında `.env` çalışmaya devam eder.
     > **Neden:** `.env` dosyaları prod'da güvenlik açığıdır — secret rotation, erişim
     > log'u ve least-privilege IAM yönetimi secrets manager gerektir.

   - [x] **Provider key encryption at rest**: `Agent.toolAccess.baseUrl` ve benzeri
     hassas alanlar için `packages/utils/src/crypto.js`'e envelope encryption fonksiyonu
     ekle (`encryptField` / `decryptField`, AES-256-GCM). DB'ye yazmadan önce şifrele,
     okurken çöz. DEK (Data Encryption Key) KEK (Key Encryption Key) ile şifrelenir;
     KEK secrets manager'dan gelir.
     > **Neden:** DB dump'ı ele geçirilse bile provider key'ler okunamaz olur.

   - [x] **Secret rotation desteği**: Secrets manager loader'ı, uygulama restart'ı
     gerekmeden env değişkenlerini yenileyebilecek şekilde hot-reload mekanizması
     ekle (scheduled refresh veya SIGHUP handler).
     > **Neden:** Key rotation sırasında downtime olmamalı.

   **Acceptance criteria (Task 4):**
   - [ ] `NODE_ENV=production` + `SECRETS_BACKEND=aws` → app secrets `.env` okumadan çalışır.
   - [ ] `toolAccess` provider key DB'de şifreli saklanır; plaintext görünmez.
   - [ ] `SIGHUP` veya scheduled refresh → yeni secret hot-reload olur, process restart gerekmez.

---

5. **Deploy & scale** (CI/CD + containers)

   - [x] **Dockerfile'lar** (`apps/api/Dockerfile`, `apps/agent-worker/Dockerfile`,
     `apps/worker-general/Dockerfile`, `apps/worker-ingestion/Dockerfile`):
     multi-stage build (deps → build → runtime); non-root user (`USER node`);
     `.dockerignore` ile `node_modules`, `.env`, `*.test.js` dışarıda bırakılır.
     > **Neden:** Non-root container güvenlik en iyi pratiği. Multi-stage build
     > final image boyutunu küçültür.

   - [x] **GitHub Actions CI pipeline** (`.github/workflows/ci.yml`):
     `lint → test → build images → push to registry` adımları; PR'da lint+test,
     merge'de image build+push; image tag olarak git SHA kullanılır.
     > **Neden:** Her PR'ın otomatik doğrulanması, regresyon önleme.

   - [x] **GitHub Actions CD pipeline** (`.github/workflows/deploy.yml`):
     Image push sonrası deployment; blue/green veya canary stratejisi; DB migration'lar
     deploy öncesi çalıştırılır (expand-only, destructive adım ayrı PR'da).
     > **Neden:** Sıfır-downtime deploy ve migration güvenliği.

   - [x] **Socket.IO Redis adapter** (`@repo/realtime`): Multi-pod ortamda Socket.IO
     event'lerinin tüm pod'lara yayılması için `socket.io-redis` adapter'ı aktif et.
     Mevcut `redisSub` yaklaşımının yerini alır.
     > **Neden:** Şu an Redis'e manuel subscribe var — resmi adapter daha güvenilir
     > ve performanslı multi-pod desteği sağlar.

   - [x] **HPA konfigürasyonu** (`infra/k8s/`): API için CPU tabanlı,
     `worker-general` ve `worker-ingestion` için BullMQ queue depth tabanlı,
     `agent-worker` için concurrent LiveKit room sayısı tabanlı HorizontalPodAutoscaler
     manifest'leri yaz.
     > **Neden:** Autoscale olmadan trafik artışında sistem manuel müdahale ister.

   - [x] **Backup & DR**: MongoDB Atlas PITR aktif; Redis AOF persistence; S3 lifecycle
     policy (30 günden eski geçici dosyalar Glacier'a, 365 günden eski silinir). DR
     playbook'u `infra/DR_PLAYBOOK.md`'ye yaz.
     > **Neden:** Felaket kurtarma senaryolarında RTO/RPO hedeflerini karşılamak için.

   **Acceptance criteria (Task 5):**
   - [ ] `docker build` her app için sorunsuz çalışır; container non-root çalışır.
   - [ ] GitHub Actions PR'da lint+test geçer; merge'de image registry'ye push edilir.
   - [ ] `kubectl apply` ile deploy; health probe geçene kadar eski pod ayakta kalır.
   - [ ] 2 API pod ayakta — Socket.IO event'i ikisine de iletilir.

---

6. **Security testing** (CI + periyodik)

   - [x] **Dependency scanning**: GitHub Actions'a `npm audit --audit-level=high` adımı
     ekle; kritik CVE varsa pipeline başarısız olur. Alternatif olarak Snyk entegrasyonu.
     > **Neden:** Üçüncü parti paketlerdeki bilinen güvenlik açıklarını otomatik yakala.

   - [x] **Container scanning**: CI'da Trivy ile image taraması;
     `HIGH` ve `CRITICAL` bulgu varsa deploy durdurulur.
     > **Neden:** Base image'da veya bağımlılıklarda CVE'leri deploy öncesi yakala.

   - [x] **Secret scanning**: `git-secrets` veya `gitleaks` pre-commit hook'u;
     CI'da da çalıştırılır. `.env` dosyaları kesinlikle commit edilmez.
     > **Neden:** Yanlışlıkla commit'e giren API key veya secret erken tespit edilir.

   - [x] **SAST**: `eslint-plugin-security` ESLint config'e eklenir; CI'da çalışır.
     Bilinen tehlikeli pattern'leri (eval, prototype pollution, path traversal) flagler.
     > **Neden:** Statik analiz, kod review'da gözden kaçan güvenlik açıklarını yakalar.

   - [x] **Rate limiting & WAF**: `POST /sessions` ve `POST /embed/*` için
     Redis token bucket rate limiter (`express-rate-limit` + `rate-limit-redis`);
     public endpoint'lere CloudFront WAF rule ekle (SQL injection, XSS pattern'ları).
     > **Neden:** En yüksek riskli public endpoint'ler abuse ve DDoS'a açık.

   - [x] **Pen-test checklist** (`infra/PENTEST_CHECKLIST.md`): OWASP Top 10'u
     baz alarak bir checklist hazırla; kritik maddelere elle test notları ekle
     (IDOR, auth bypass, SSRF, injection, insecure direct object reference).
     > **Neden:** Otomatik tarama yeterli değil; manuel test ile gap'leri kapat.

   **Acceptance criteria (Task 6):**
   - [ ] `npm audit` CI'da çalışır; yüksek CVE varsa pipeline kırmızı.
   - [ ] Trivy taraması CI'a entegre; `CRITICAL` bulgu deploy'u engeller.
   - [ ] Pre-commit + CI'da secret scanning aktif.
   - [ ] `/sessions` endpoint'i dakikada 20 isteği aşınca 429 döner.

---

## Data model additions

| Collection | Key fields |
|---|---|
| `ApiKey` | `workspaceId`, `name`, `keyHash` (SHA-256), `prefix`, `scopes[]`, `lastUsedAt`, `revokedAt` |
| `AuditLog` | `workspaceId`, `actorId`, `actorType`, `action`, `target{type,id}`, `before`, `after`, `ip`, `userAgent`, `at` |
| `AuthSession` | `userId`, `refreshTokenHash`, `device`, `ip`, `revokedAt`, `expiresAt`, `family` (rotation zinciri) |

> Mevcut modeller: `User` → `twoFactorSecret`, `twoFactorEnabled` alanları eklenir.
> `Agent` → `rawTranscriptEnabled` alanı eklenir.
> `Workspace` → `retentionDays` alanı eklenir.

---

## API additions

```
# Auth hardening
POST   /api/v1/auth/2fa/enable          # secret üretir, QR döner (requireAuth)
POST   /api/v1/auth/2fa/verify          # TOTP kodu doğrular, 2FA aktif eder
POST   /api/v1/auth/2fa/disable         # şifre re-doğrulama ile 2FA deaktif

# API keys (scoped programmatic access)
POST   /api/v1/api-keys                 # plain key bir kez gösterilir (requireAuth + requirePermission)
DELETE /api/v1/api-keys/:id             # revoke (requireAuth + owner/admin)
GET    /api/v1/api-keys                 # workspace key listesi (sadece prefix görünür)

# Privacy / GDPR
POST   /api/v1/privacy/export           # tüm workspace verisini export eder (requireAuth + OWNER)
POST   /api/v1/privacy/delete           # tüm workspace verisini siler (requireAuth + OWNER)

# Audit
GET    /api/v1/audit-logs               # filtrelenmiş, sayfalı (requireAuth + requirePermission('audit:read'))
```

---

## Acceptance criteria

- [x] Refresh-token reuse algılandığında tüm session ailesi iptal edilir ve `AuditLog`'a yazılır.
- [x] Transcriptler varsayılan olarak PII-redacted saklanır; `rawTranscriptEnabled:true` ile ham.
- [x] Data export/erasure istekleri tamamlanır ve `AuditLog`'a kaydedilir.
- [x] Privileged action'lar immutable `AuditLog`'da görünür.
- [ ] CI pipeline: lint → test → `npm audit` → Trivy scan → image build → push.
- [ ] 2+ API pod + Socket.IO Redis adapter: event her pod'a iletilir.
- [x] `/sessions` rate limiter: 429 döner.
- [ ] DR drill: MongoDB PITR'dan restore başarılı.

*(Yukarıdaki tüm tamamlanmış kabul kriterleri, 'backend_tests/phase8_security_compliance.mjs' otomatik test paketi ve Postman üzerinden manuel test rehberi ile 22.07.2026 tarihinde doğrulanmıştır.)*

---

## Risks

- **Over-redaction** — PII regex'i çok agresif olursa meşru veriyi siler;
  `rawTranscriptEnabled` toggle'ı workspace seviyesinde kontrol sağlar. Pattern'leri
  test setinde doğrula.
- **Migration safety** — expand/contract stratejisi: önce yeni alan ekle (non-breaking),
  sonra eski alanı deprecated et, en son kaldır. Hiçbir zaman tek adımda destructive migration.
- **Secret sprawl** — tüm secret'lar secrets manager'da; `.env` sadece dev; least-privilege
  IAM policy; erişim logları periyodik review.
- **Refresh rotation race** — eşzamanlı iki refresh isteği gelirse yalnızca biri kazanmalı;
  DB seviyesinde atomic findOneAndUpdate + CAS (Compare-and-Swap) kullan.
- **2FA recovery** — TOTP cihazı kaybolursa erişim kilitlenir; backup code mekanizması
  (8 tek kullanımlık kod) 2FA enable anında üretilip kullanıcıya gösterilmeli.

---

## Test

```bash
node backend_tests/phase8_security_compliance.mjs
```

Test kapsamı (planlanan):
- `AuthSession` model doğrulama (kayıt, revoke, reuse detection)
- `AuditLog` immutability testi (update/delete denemeleri reddedilir)
- `POST /auth/login` lockout (5 başarısız deneme → 429/423)
- `POST /auth/refresh` — rotation: eski token geçersiz, yeni token geçerli
- `POST /auth/refresh` — reuse: tüm session ailesi iptal edilir
- `POST /api-keys` → `DELETE /api-keys/:id` → revoked key reddedilir
- `POST /auth/2fa/enable` → `POST /auth/2fa/verify` → login flow
- `GET /audit-logs` → filtrelenmiş, sayfalı; admin olmayan → 403
- `POST /privacy/export` → JSON döner + `AuditLog` kaydı
- `POST /privacy/delete` → live session varken 409; yokken silme + log
- `purge-expired-data` job → `retentionDays` geçmiş session silinir
- PII redact: email/telefon `[REDACTED]` olur; `rawTranscriptEnabled:true` → ham
- Rate limiter: `/sessions` 20 req/dk limitini aşınca 429
