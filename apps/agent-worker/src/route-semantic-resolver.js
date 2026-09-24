import { semanticIdentityForKnowledgeIntent } from '@repo/contracts';

function normalizedUrl(value) {
    if (!value) return null;
    try {
        const url = new URL(value);
        url.hash = '';
        if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
        return url.toString();
    } catch {
        return null;
    }
}

/**
 * Resolves a question to an existing playbook topic only when browser/knowledge
 * provenance yields one unambiguous page match. Ambiguity fails back to the
 * per-intent identity; objective text is never heuristically guessed here.
 */
export function resolveRouteSemanticIdentity({ context, intentId, evidenceRefs = [] }) {
    const observedUrls = new Set([
        ...(context.knowledge?.evidence ?? []).map((item) => item.page?.url),
        ...(context.allowedDemoTargets ?? []).map((target) => target.pageUrl)
    ].map(normalizedUrl).filter(Boolean));

    const candidates = context.currentRoute.filter((node) => {
        const routeUrl = normalizedUrl(node.pageIntent?.preferredUrl);
        return node.semanticIdentity && routeUrl && observedUrls.has(routeUrl);
    });
    const byTopic = new Map(candidates.map((node) => [
        node.semanticIdentity.topicId,
        node.semanticIdentity
    ]));
    if (byTopic.size !== 1) {
        return semanticIdentityForKnowledgeIntent(intentId, evidenceRefs);
    }

    const [matched] = byTopic.values();
    const evidenceIdentity = semanticIdentityForKnowledgeIntent(intentId, evidenceRefs);
    return {
        topicId: matched.topicId,
        claimIds: [...new Set([...matched.claimIds, ...evidenceIdentity.claimIds])].slice(0, 20),
        source: 'semantic_resolver'
    };
}
