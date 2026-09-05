import { embed } from '@repo/ai';
import { KnowledgeAudit, KnowledgeSource } from '@repo/database';
import { Logger } from '@repo/logger';
import { getVectorStore } from '../stores/index.js';
import { clusterChunks } from './cluster.js';
import { reviewCluster } from './review.js';
import { findingKey } from './index.js';

/**
 * Runs automatically at the end of `ingestSource()`, before a source is
 * marked 'ready' — the "Katman 2" half of ingestion-time cleanup (Katman 1,
 * exact-text collapse, already ran in ingest.js before embedding).
 *
 * Reuses the SAME clustering (0.88 cosine similarity, `clusterChunks`) and
 * the SAME LLM reviewer (`reviewCluster`) as the manual "Bilgi Denetimi"
 * audit — this is deliberately not a separate, looser mechanism. The
 * reviewer's own rule is what keeps this safe to run unattended: "Numbers,
 * units and currencies differing for the SAME subject is a contradiction,
 * not a duplicate" (see review.js's REVIEW_SYSTEM) — a price/contact-detail
 * change can score HIGHER on cosine similarity than a harmless reworded
 * duplicate (measured: 0.947 for a price contradiction vs 0.918 for a real
 * duplicate), so a similarity threshold alone can never be trusted to decide
 * what to auto-remove. Only the reviewer's actual verdict decides:
 *
 *  - "duplicate" — the fact lists are equivalent. Auto-applied immediately,
 *    no human involved, same as approving it in the console would do.
 *  - "contradiction" — two chunks disagree on the same fact. NEVER
 *    auto-applied (deciding which value is true is a business call this
 *    system cannot make) — recorded as a normal, pending `KnowledgeAudit` so
 *    it shows up in the existing "Bilgi Denetimi" screen for a person to
 *    resolve, exactly like a manually-triggered run's findings would.
 *
 * Scoped to just this source's own chunks (not the whole product) — that is
 * where every duplicate observed in practice actually was, and it keeps this
 * pass fast and cheap relative to a full manual audit.
 *
 * Never throws: a failure here is a missed cleanup opportunity, not a reason
 * to fail an otherwise-successful ingestion.
 *
 * @param {{ productId:string, sourceId:string }} input
 */
export async function autoDedupeSourceChunks({ productId, sourceId }) {
    try {
        const store = getVectorStore();
        const chunks = await store.listByProduct({ productId, sourceId, limit: 2000 });
        if (chunks.length < 2) return;

        // Position within the source, for clusterChunks' chunker-overlap
        // exclusion (adjacent chunks share `chunkText`'s own 200-char overlap
        // by construction — not a real redundancy, see cluster.js).
        const ordered = chunks.map((c, i) => ({ ...c, ordinal: i }));

        const { clusters } = clusterChunks(ordered, { maxClusters: MAX_CLUSTERS() });
        if (!clusters.length) return;

        const source = await KnowledgeSource.findById(sourceId).select('title type updatedAt').lean();
        const chunkById = new Map(
            ordered.map((c) => [
                c.id,
                { ...c, sourceTitle: source?.title, sourceType: source?.type, sourceUpdatedAt: source?.updatedAt }
            ])
        );

        const reviewed = await mapWithConcurrency(clusters, CONCURRENCY(), async (cluster) => {
            const members = cluster.chunkIds.map((id) => chunkById.get(id)).filter(Boolean);
            const verdict = await reviewCluster(members);
            return verdict ? { cluster, verdict } : null;
        });

        let dupApplied = 0;
        let dupFailed = 0;
        const contradictionFindings = [];

        for (const entry of reviewed) {
            if (!entry) continue;
            const { cluster, verdict } = entry;

            if (verdict.verdict === 'contradiction') {
                contradictionFindings.push({
                    key: findingKey('contradiction', cluster.chunkIds),
                    type: 'contradiction',
                    summary: verdict.summary,
                    rationale: verdict.rationale,
                    chunkIds: cluster.chunkIds,
                    keepChunkId: verdict.keepChunkId || undefined,
                    canonicalText: verdict.canonicalText || undefined,
                    audience: chunkById.get(cluster.chunkIds[0])?.audience || 'general',
                    similarity: cluster.similarity,
                    decision: 'pending'
                });
                continue;
            }

            // verdict.verdict === 'duplicate' — the only other value
            // reviewCluster ever returns (see its own return contract).
            try {
                if (verdict.canonicalText) {
                    const embedding = await embed(verdict.canonicalText);
                    const [newChunkId] = await store.upsert([
                        {
                            productId,
                            sourceId,
                            text: verdict.canonicalText,
                            embedding,
                            modality: 'text',
                            audience: chunkById.get(cluster.chunkIds[0])?.audience || 'general',
                            status: 'active',
                            curatedFrom: cluster.chunkIds,
                            metadata: { curated: true, autoDeduped: true }
                        }
                    ]);
                    await store.setStatus({ ids: cluster.chunkIds, status: 'superseded', supersededBy: newChunkId });
                } else if (verdict.keepChunkId) {
                    const retire = cluster.chunkIds.filter((id) => id !== verdict.keepChunkId);
                    if (retire.length) {
                        await store.setStatus({ ids: retire, status: 'superseded', supersededBy: verdict.keepChunkId });
                    }
                }
                dupApplied++;
            } catch (err) {
                dupFailed++;
                Logger.warn(
                    { productId, sourceId, error: err.message },
                    '[ingest] auto-dedupe: failed to apply a duplicate finding (left in place)'
                );
            }
        }

        if (contradictionFindings.length) {
            await KnowledgeAudit.create({
                productId,
                status: 'ready',
                startedAt: new Date(),
                finishedAt: new Date(),
                findings: contradictionFindings,
                stats: { auto: true, sourceId: String(sourceId), clusters: clusters.length }
            });
        }

        if (dupApplied || dupFailed || contradictionFindings.length) {
            Logger.info(
                { productId, sourceId, dupApplied, dupFailed, contradictions: contradictionFindings.length },
                '[ingest] auto-dedupe finished'
            );
        }
    } catch (err) {
        Logger.warn(
            { productId, sourceId, error: err.message },
            '[ingest] auto-dedupe failed (non-fatal, source still marked ready)'
        );
    }
}

/** Ceiling on reviewed clusters per ingestion run — each one is a paid LLM call. */
const MAX_CLUSTERS = () => Number(process.env.INGEST_AUTO_DEDUPE_MAX_CLUSTERS || 20);

/** Parallel LLM calls. */
const CONCURRENCY = () => Number(process.env.INGEST_AUTO_DEDUPE_CONCURRENCY || 4);

/** Runs `task` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency(items, limit, task) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await task(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
