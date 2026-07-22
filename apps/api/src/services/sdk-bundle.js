import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Logger } from '@repo/logger';

const require = createRequire(import.meta.url);

let cached; // { content: string, version: string } | undefined

/**
 * Loads the built @repo/sdk browser bundle (`dist/salesai.js`, produced by
 * `npm run build -w @repo/sdk`) plus its package version, caching the result
 * in memory after the first successful read.
 *
 * Returns null if the bundle hasn't been built yet — the caller should
 * respond 503 rather than let a missing static asset crash request
 * handling. Not cached on failure, so the very next request will retry the
 * read (picks up a build that finishes after the API already started,
 * without requiring a restart).
 */
export function loadSdkBundle() {
    if (cached) return cached;
    try {
        const pkgPath = require.resolve('@repo/sdk/package.json');
        const { version } = require(pkgPath);
        const content = readFileSync(join(dirname(pkgPath), 'dist', 'salesai.js'), 'utf8');
        cached = { content, version };
        return cached;
    } catch (err) {
        Logger.warn('SDK bundle not built yet — run `npm run build -w @repo/sdk`', { error: err.message });
        return null;
    }
}

/**
 * The @repo/sdk package's declared version — used to cache-bust the embed
 * snippet's script URL (see routes/sdk.js). Independent of `loadSdkBundle`
 * on purpose: a seller can save embed config and get a correct, versioned
 * snippet before the bundle is actually built/deployed.
 */
export function getSdkVersion() {
    return require('@repo/sdk/package.json').version;
}
