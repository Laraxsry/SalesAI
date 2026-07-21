import { EmbedConfig } from '@repo/database';
import { resolveShareLink } from '../services/share-link-sessions.js';

/**
 * Resolves `req.params.token` into `{ link, agent, embedConfig }` and attaches
 * it as `req.embed`, or ends the request with the appropriate status.
 *
 * Reuses `resolveShareLink` (Phase 2's own validity rules — active, not
 * expired, session cap, agent status) so a widget and a mailed link are
 * governed by the exact same "is this link still usable" logic; per the
 * chosen design (Decision: shared ShareLink token, not a separate embed
 * token), that reuse is the whole point.
 *
 * An agent with no `EmbedConfig` has never opted into embedding, so both
 * embed endpoints 404 for it even if its share link is perfectly valid.
 */
export async function resolveEmbedContext(req, res, next) {
    try {
        const resolved = await resolveShareLink(req.params.token);
        if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.error });

        const { link, agent } = resolved;
        const embedConfig = await EmbedConfig.findOne({ agentId: agent._id });
        if (!embedConfig) return res.status(404).json({ error: 'Embed not configured for this agent' });

        req.embed = { link, agent, embedConfig };
        next();
    } catch (err) {
        next(err);
    }
}
