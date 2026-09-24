function boundedTopK(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 8;
    return Math.max(1, Math.min(50, Math.trunc(numeric)));
}

function intentIdFor(productId, query) {
    const normalized = query.toLocaleLowerCase('tr').replace(/\s+/g, ' ');
    let hash = 2166136261;
    for (const char of `${productId}:${normalized}`) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return `knowledge:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Convert an observed customer question into a bounded retrieval intent. */
export function createKnowledgeResolutionIntent({
    productId,
    query,
    topK = 8,
    preferredAudience = 'general'
}) {
    const normalizedProductId = String(productId ?? '').trim();
    const normalizedQuery = String(query ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000);
    if (!normalizedProductId) throw new TypeError('productId is required');
    if (!normalizedQuery) throw new TypeError('query is required');

    return {
        intentId: intentIdFor(normalizedProductId, normalizedQuery),
        productId: normalizedProductId,
        query: normalizedQuery,
        topK: boundedTopK(topK),
        preferredAudience: preferredAudience === 'technical' ? 'technical' : 'general'
    };
}

function pageFrom(chunk) {
    if (!chunk.metadata?.pageUrl) return null;
    return {
        url: chunk.metadata.pageUrl,
        tabLabel: chunk.metadata.tabLabel ?? null,
        elementKey: chunk.metadata.elementKey ?? null,
        elementPath: chunk.metadata.elementPath ?? null,
        elementType: chunk.metadata.elementType ?? null,
        heading: chunk.metadata.heading ?? null
    };
}

function evidenceFrom(chunk, index) {
    return {
        evidenceId: `knowledge:${chunk.id ?? `${chunk.sourceId}:${index}`}`,
        kind: 'knowledge',
        text: chunk.text,
        score: chunk.score,
        sourceId: String(chunk.sourceId),
        page: pageFrom(chunk)
    };
}

function demoTargetsFrom(evidence) {
    const targets = new Map();
    for (const item of evidence) {
        if (!item.page) continue;
        const key = [item.page.url, item.page.tabLabel, item.page.elementKey].join('|');
        if (!targets.has(key)) {
            targets.set(key, {
                pageUrl: item.page.url,
                tabLabel: item.page.tabLabel,
                elementKey: item.page.elementKey,
                elementPath: item.page.elementPath,
                elementType: item.page.elementType,
                heading: item.page.heading
            });
        }
    }
    return [...targets.values()];
}

/**
 * KnowledgeResolver port implementation backed by an injected chunk retriever.
 * Retrieval failures and honest empty results are separate outcomes: only an
 * empty successful lookup may become a knowledge-gap candidate.
 *
 * @param {{retrieveChunks:(intent:object)=>Promise<object[]>}} deps
 */
export function createKnowledgeResolver({ retrieveChunks }) {
    if (typeof retrieveChunks !== 'function') throw new TypeError('retrieveChunks port is required');

    return {
        async resolve(input) {
            const intent = createKnowledgeResolutionIntent(input);
            let chunks;
            try {
                chunks = await retrieveChunks(intent);
            } catch (cause) {
                return {
                    intentId: intent.intentId,
                    query: intent.query,
                    status: 'unavailable',
                    evidence: [],
                    demoTargets: [],
                    knowledgeGap: { status: 'none', reason: 'retrieval_unavailable' },
                    cause
                };
            }

            const evidence = (Array.isArray(chunks) ? chunks : [])
                .filter((chunk) => chunk && typeof chunk.text === 'string' && chunk.text.trim()
                    && typeof chunk.sourceId !== 'undefined' && Number.isFinite(chunk.score))
                .map(evidenceFrom);
            const demoTargets = demoTargetsFrom(evidence);

            if (evidence.length === 0) {
                return {
                    intentId: intent.intentId,
                    query: intent.query,
                    status: 'not_found',
                    evidence: [],
                    demoTargets: [],
                    knowledgeGap: { status: 'candidate', reason: 'no_grounding_evidence' }
                };
            }

            return {
                intentId: intent.intentId,
                query: intent.query,
                status: demoTargets.length > 0 ? 'grounded_with_demo' : 'grounded',
                evidence,
                demoTargets,
                knowledgeGap: { status: 'none', reason: null }
            };
        }
    };
}

/** Preserve the existing search_knowledge tool payload during migration. */
export function knowledgeResolutionToToolResult(resolution) {
    return resolution.evidence.map((item) => ({
        text: item.text,
        score: item.score,
        sourceId: item.sourceId,
        ...(item.page?.url && { pageUrl: item.page.url }),
        ...(item.page?.tabLabel && { tabLabel: item.page.tabLabel }),
        ...(item.page?.elementKey && { elementKey: item.page.elementKey }),
        ...(item.page?.elementPath && { elementPath: item.page.elementPath }),
        ...(item.page?.elementType && { elementType: item.page.elementType }),
        ...(item.page?.heading && { heading: item.page.heading })
    }));
}
