import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Side-effecting module: loads the monorepo-root `.env` regardless of the
 * current working directory. Apps run from their own folder (e.g. apps/api)
 * under workspace dev scripts, so a plain `dotenv/config` would miss the root
 * `.env`. Import this as the FIRST import of every service entrypoint.
 *
 *   import '@repo/config-env/load';
 *
 * Phase 8 Task 4.1 — SECRETS_BACKEND desteği:
 *   SECRETS_BACKEND=env   → varsayılan, .env dosyasından okur (dev)
 *   SECRETS_BACKEND=aws   → AWS Secrets Manager'dan çeker (prod)
 *   SECRETS_BACKEND=vault → HashiCorp Vault HTTP API'sinden çeker (prod)
 *
 * Phase 8 Task 4.3 — SIGHUP Hot-reload:
 *   SIGHUP sinyali geldiğinde loadSecrets() yeniden çağrılır,
 *   process.env üzerine yeni değerler yazılır. Restart gerekmez.
 */

function findEnvFile(startDir) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        const candidate = path.join(dir, '.env');
        if (fs.existsSync(candidate)) return candidate;
        // Stop at the workspace root (the package.json that declares workspaces).
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg)) {
            try {
                const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
                if (json.workspaces) {
                    const rootEnv = path.join(dir, '.env');
                    return fs.existsSync(rootEnv) ? rootEnv : null;
                }
            } catch {
                // ignore malformed package.json
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * AWS Secrets Manager'dan tüm secret'ları çekip process.env'e yazar.
 * SECRETS_ARN veya SECRETS_NAME ortam değişkeni gereklidir.
 * @returns {Promise<void>}
 */
async function loadFromAws() {
    try {
        const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
        const secretId = process.env.SECRETS_ARN || process.env.SECRETS_NAME;
        if (!secretId) {
            console.warn('[config-env] SECRETS_BACKEND=aws but SECRETS_ARN/SECRETS_NAME not set — falling back to env');
            return;
        }
        const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
        const cmd = new GetSecretValueCommand({ SecretId: secretId });
        const resp = await client.send(cmd);
        const secrets = JSON.parse(resp.SecretString || '{}');
        for (const [k, v] of Object.entries(secrets)) {
            process.env[k] = String(v);
        }
        console.info(`[config-env] Loaded ${Object.keys(secrets).length} secrets from AWS Secrets Manager`);
    } catch (err) {
        console.error('[config-env] AWS Secrets Manager load failed:', err?.message);
    }
}

/**
 * HashiCorp Vault'tan secret çekip process.env'e yazar.
 * VAULT_ADDR ve VAULT_TOKEN ortam değişkenleri gereklidir.
 * VAULT_SECRET_PATH: vault kv secret path'i (örn. "secret/data/salesai")
 * @returns {Promise<void>}
 */
async function loadFromVault() {
    try {
        const addr = process.env.VAULT_ADDR || 'http://localhost:8200';
        const token = process.env.VAULT_TOKEN;
        const secretPath = process.env.VAULT_SECRET_PATH || 'secret/data/salesai';
        if (!token) {
            console.warn('[config-env] SECRETS_BACKEND=vault but VAULT_TOKEN not set — falling back to env');
            return;
        }
        const url = `${addr}/v1/${secretPath}`;
        const resp = await fetch(url, {
            headers: { 'X-Vault-Token': token }
        });
        if (!resp.ok) {
            console.error(`[config-env] Vault fetch failed: ${resp.status}`);
            return;
        }
        const json = await resp.json();
        const secrets = json?.data?.data || json?.data || {};
        for (const [k, v] of Object.entries(secrets)) {
            process.env[k] = String(v);
        }
        console.info(`[config-env] Loaded ${Object.keys(secrets).length} secrets from Vault`);
    } catch (err) {
        console.error('[config-env] Vault load failed:', err?.message);
    }
}

/**
 * Ortam değişkenine göre doğru backend'den secret yükler.
 * @returns {Promise<void>}
 */
async function loadSecrets() {
    const backend = process.env.SECRETS_BACKEND || 'env';

    if (backend === 'aws') {
        await loadFromAws();
    } else if (backend === 'vault') {
        await loadFromVault();
    } else {
        // Default: .env dosyasından oku
        const envPath = findEnvFile(process.cwd());
        dotenv.config(envPath ? { path: envPath } : undefined);
    }
}

// ── İlk yükleme (senkron için .env, async backend'ler için fire-and-forget) ──
const backend = process.env.SECRETS_BACKEND || 'env';
if (backend === 'env') {
    // Senkron — diğer import'lardan önce tamamlanması gerekiyor
    const envPath = findEnvFile(process.cwd());
    dotenv.config(envPath ? { path: envPath } : undefined);
} else {
    // Async backend: fire-and-forget (uygulama başlamadan önce tamamlanmak
    // için top-level await kullanılabilir; burada uyarı veriyoruz)
    loadSecrets().catch(err =>
        console.error('[config-env] Initial secret load failed:', err?.message)
    );
}

// ── Phase 8 Task 4.3: SIGHUP Hot-reload ──────────────────────────────────────
// SIGHUP sinyali alındığında secret'ları yeniden yükle (process restart gerekmez).
// Ör: `kill -HUP <PID>` veya Docker'da `docker kill --signal=SIGHUP <container>`
if (process.platform !== 'win32') {
    // SIGHUP Windows'ta desteklenmez
    process.on('SIGHUP', () => {
        console.info('[config-env] SIGHUP received — reloading secrets...');
        loadSecrets()
            .then(() => console.info('[config-env] Secrets hot-reloaded successfully'))
            .catch(err => console.error('[config-env] Secret hot-reload failed:', err?.message));
    });
} else {
    // Windows'ta SIGHUP yok — zamanlanmış yenileme (her 5 dakikada bir)
    const REFRESH_INTERVAL_MS = Number(process.env.SECRETS_REFRESH_INTERVAL_MS || 300_000);
    if (backend !== 'env' && REFRESH_INTERVAL_MS > 0) {
        setInterval(() => {
            loadSecrets().catch(err =>
                console.error('[config-env] Scheduled secret refresh failed:', err?.message)
            );
        }, REFRESH_INTERVAL_MS).unref(); // .unref() → interval process'i canlı tutmaz
    }
}

export { loadSecrets };
export {};

