import { Router } from 'express';
import { loadSdkBundle } from '../services/sdk-bundle.js';

export const sdkRouter = Router();

/**
 * Serves the embeddable widget loader (md/backend/phase5: GET /sdk/salesai.js).
 *
 * The route path never changes; cache-busting instead comes from a `?v=`
 * query string that callers append themselves (the snippet returned by
 * POST /agents/:id/embed always appends the @repo/sdk package's current
 * version). Browsers and CDNs key their cache on the full URL including the
 * query string, so `?v=0.1.0` and `?v=0.1.1` are cached as entirely separate
 * responses — bumping the package version is what invalidates the old,
 * `immutable`-cached copy, without us needing multiple routes or a manifest.
 * The `v` param itself isn't read here: there is only ever one currently
 * built bundle in memory, so nothing branches on its value.
 *
 * Trade-off worth knowing: a seller's page that already has an old `?v=`
 * baked into its HTML keeps requesting that exact URL — and since browsers
 * treat this response as `immutable`, that visitor's browser may serve its
 * own previously-cached copy indefinitely. That's the standard, accepted
 * behavior of every versioned-CDN-asset scheme (jsdelivr, unpkg, ...): a
 * seller adopts a new loader version by copying a fresh snippet, not
 * automatically.
 */
sdkRouter.get('/salesai.js', (req, res) => {
    const bundle = loadSdkBundle();
    if (!bundle) return res.status(503).json({ error: 'SDK bundle not available' });

    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(bundle.content);
});
