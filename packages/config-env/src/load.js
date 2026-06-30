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

const envPath = findEnvFile(process.cwd());
dotenv.config(envPath ? { path: envPath } : undefined);

export {};
