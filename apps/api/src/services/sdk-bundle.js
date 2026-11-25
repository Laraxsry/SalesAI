import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Logger } from '@repo/logger';

const require = createRequire(import.meta.url);

let cached; // { content: string, version: string, mtimeMs: number } | undefined

/**
 * Loads the built @repo/sdk browser bundle (`dist/salesai.js`, produced by
 * `npm run build -w @repo/sdk`) plus its package version, caching the result
 * in memory and re-reading only when the bundle file's mtime changes.
 *
 * The mtime check matters because the bundle is read from disk, not
 * imported: `node --watch` never sees it change, so a plain once-and-forever
 * cache kept serving the old loader after every SDK rebuild until the API was
 * restarted by hand. One stat per request is negligible next to the response
 * itself (and the route is `immutable`-cached by browsers/CDNs anyway).
 *
 * Returns null if the bundle hasn't been built yet — the caller should
 * respond 503 rather than let a missing static asset crash request
 * handling. If the file is briefly unreadable after a successful load (e.g.
 * mid-rebuild), the last good bundle keeps being served.
 */
export function loadSdkBundle() {
    try {
        const pkgPath = require.resolve('@repo/sdk/package.json');
        const bundlePath = join(dirname(pkgPath), 'dist', 'salesai.js');
        const { mtimeMs } = statSync(bundlePath);
        if (cached?.mtimeMs === mtimeMs) return cached;

        // Read package.json from disk rather than `require` it: require's
        // module cache would pin the version from the first load forever.
        const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const content = readFileSync(bundlePath, 'utf8');
        cached = { content, version, mtimeMs };
        return cached;
    } catch (err) {
        if (cached) return cached;
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
