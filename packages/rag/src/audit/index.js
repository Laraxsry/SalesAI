import { createHash } from 'node:crypto';
import { embed } from '@repo/ai';
import { KnowledgeAudit, KnowledgeSource } from '@repo/database';
import { Logger } from '@repo/logger';
import { getVectorStore } from '../stores/index.js';
import { invalidateProductCache } from '../retrieve.js';
import { clusterChunks } from './cluster.js';
import { reviewCluster, reviewJunkBatch, JUNK_BATCH_SIZE } from './review.js';

/**
 * Knowledge audit: reads a product's knowledge back out of the vector store,
 * finds what is redundant, contradictory or worthless, and proposes fixes.
 *
 * Two hard rules shape everything here:
 *
 *  1. Nothing is applied without a person approving it. A finding is a
 *     proposal. An LLM deciding on its own that a chunk is unnecessary would
 *     take away the agent's ability to answer something and nobody would
 *     notice — the agent would simply start saying it doesn't know.
 *
 *  2. Raw chunks are never edited or deleted. Applying a finding writes a new
 *     *curated* chunk and marks the originals superseded, so the ingestion
 *     output stays the source of truth and every decision can be traced and
 *     undone.
 */

/** Ceiling on how much of a product's knowledge one run looks at. */
const MAX_CHUNKS = () => Number(process.env.KNOWLEDGE_AUDIT_MAX_CHUNKS || 2000);

/** Ceiling on reviewed clusters — each one is a paid LLM call. */
const MAX_CLUSTERS = () => Number(process.env.KNOWLEDGE_AUDIT_MAX_CLUSTERS || 40);

/** Parallel LLM calls. Enough to keep a run to minutes, low enough to stay under rate limits. */
const CONCURRENCY = () => Number(process.env.KNOWLEDGE_AUDIT_CONCURRENCY || 4);

/**
 * Circuit breaker on the junk scan.
 *
 * Observed against a real crawled site: the scanner flagged 34 of 40 chunks,
 * "navigation menu" on chunks that also carried prices and ordering steps —
 * because a fixed-length cut of a web page puts menu text in front of real
 * content. A product whose knowledge is mostly junk is not a finding, it is a
 * broken scan; surfacing 34 approve buttons only invites someone to approve
 * them all and gut the knowledge base. Above this share the junk findings are
 * withheld and the run says so.
 */
const JUNK_MAX_SHARE = () => Number(process.env.KNOWLEDGE_AUDIT_JUNK_MAX_SHARE || 0.35);

const CURATED_SOURCE_TITLE = 'Curated knowledge (audit)';

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

/**
 * Stable identifier for a finding, so re-running an audit over unchanged
 * knowledge produces the same keys and the console can tell an old proposal
 * from a new one.
 */
function findingKey(type, chunkIds) {
    const digest = createHash('sha1').update([...chunkIds].sort().join(',')).digest('hex');
    return `${type}:${digest.slice(0, 12)}`;
}

/**
 * Scans a product's knowledge and records what it found as pending proposals.
 *
 * @param {{ productId:string, auditId:string }} input
 * @returns {Promise<{findings:number, stats:object}>}
 */
export async function runKnowledgeAudit({ productId, auditId }) {
    const store = getVectorStore();
    await KnowledgeAudit.findByIdAndUpdate(auditId, {
        status: 'running',
        startedAt: new Date()
    });

    try {
        const maxChunks = MAX_CHUNKS();
        const chunks = await store.listByProduct({ productId, limit: maxChunks });

        if (chunks.length < 2) {
            const stats = { chunks: chunks.length, clusters: 0, comparisons: 0, llmCalls: 0 };
            await KnowledgeAudit.findByIdAndUpdate(auditId, {
                status: 'ready',
                findings: [],
                stats,
                finishedAt: new Date()
            });
            return { findings: 0, stats };
        }

        // Which document a chunk came from, and when that document was last
        // updated, is the evidence the reviewer uses to pick the authoritative
        // side of a contradiction — without it, it can only guess.
        const sources = await KnowledgeSource.find({ productId }).select('title type updatedAt').lean();
        const sourceById = new Map(sources.map((s) => [String(s._id), s]));
        const enrich = (chunk) => {
            const source = sourceById.get(chunk.sourceId);
            return {
                ...chunk,
                sourceTitle: source?.title,
                sourceType: source?.type,
                sourceUpdatedAt: source?.updatedAt
            };
        };
        const chunkById = new Map(chunks.map((c) => [c.id, enrich(c)]));

        // Position within its own source. `listByProduct` returns insertion
        // order, which is the order `chunkText` produced them in, so
        // consecutive ordinals are exactly the pairs that share overlap text.
        const seen = new Map();
        const ordered = chunks.map((c) => {
            const next = (seen.get(c.sourceId) ?? -1) + 1;
            seen.set(c.sourceId, next);
            return { ...c, ordinal: next };
        });

        const { clusters, comparisons, truncated } = clusterChunks(ordered, {
            maxClusters: MAX_CLUSTERS()
        });

        const concurrency = CONCURRENCY();
        const reviewed = await mapWithConcurrency(clusters, concurrency, async (cluster) => {
            const members = cluster.chunkIds.map((id) => chunkById.get(id)).filter(Boolean);
            const verdict = await reviewCluster(members);
            return verdict ? { cluster, verdict } : null;
        });

        const findings = [];
        for (const entry of reviewed) {
            if (!entry) continue;
            const { cluster, verdict } = entry;
            findings.push({
                key: findingKey(verdict.verdict, cluster.chunkIds),
                type: verdict.verdict,
                summary: verdict.summary,
                rationale: verdict.rationale,
                chunkIds: cluster.chunkIds,
                keepChunkId: verdict.keepChunkId || undefined,
                canonicalText: verdict.canonicalText || undefined,
                audience: chunkById.get(cluster.chunkIds[0])?.audience || 'general',
                similarity: cluster.similarity,
                decision: 'pending'
            });
        }

        // Junk is a per-chunk property, not a group one, so it gets its own
        // batched pass over everything rather than riding along with clusters.
        const junkBatches = [];
        for (let i = 0; i < chunks.length; i += JUNK_BATCH_SIZE) {
            junkBatches.push(chunks.slice(i, i + JUNK_BATCH_SIZE));
        }
        const junkResults = await mapWithConcurrency(junkBatches, concurrency, (batch) =>
            reviewJunkBatch(batch)
        );
        const flaggedJunk = junkResults.flat();
        const junkShare = flaggedJunk.length / chunks.length;
        const junkSuppressed = junkShare > JUNK_MAX_SHARE() ? flaggedJunk.length : 0;

        if (!junkSuppressed) {
            for (const flagged of flaggedJunk) {
                findings.push({
                    key: findingKey('junk', [flagged.chunkId]),
                    type: 'junk',
                    summary: flagged.reason || 'Carries no product knowledge',
                    rationale: '',
                    chunkIds: [flagged.chunkId],
                    decision: 'pending'
                });
            }
        } else {
            Logger.warn(
                { productId, flagged: flaggedJunk.length, chunks: chunks.length },
                '[audit] junk findings withheld: implausible share flagged'
            );
        }

        const stats = {
            chunks: chunks.length,
            chunksTruncated: chunks.length >= maxChunks,
            comparisons,
            clusters: clusters.length,
            clustersTruncated: truncated,
            junkFlagged: flaggedJunk.length,
            junkSuppressed,
            llmCalls: clusters.length + junkBatches.length
        };

        await KnowledgeAudit.findByIdAndUpdate(auditId, {
            status: 'ready',
            findings,
            stats,
            finishedAt: new Date()
        });
        Logger.info({ productId, ...stats, findings: findings.length }, '[audit] knowledge audit finished');
        return { findings: findings.length, stats };
    } catch (err) {
        await KnowledgeAudit.findByIdAndUpdate(auditId, {
            status: 'failed',
            error: err.message,
            finishedAt: new Date()
        });
        throw err;
    }
}

/** The synthetic source that owns everything an audit writes. */
async function getCuratedSource(productId) {
    return KnowledgeSource.findOneAndUpdate(
        { productId, type: 'curated' },
        {
            $setOnInsert: {
                productId,
                type: 'curated',
                title: CURATED_SOURCE_TITLE,
                status: 'ready'
            }
        },
        { upsert: true, new: true }
    );
}

/**
 * Applies the findings a person approved.
 *
 * @param {{ auditId:string, approvedKeys:string[], rejectedKeys?:string[] }} input
 * @returns {Promise<{applied:number, rejected:number, failed:number, curatedChunks:number, cacheEntriesDropped:number}>}
 */
export async function applyAuditFindings({ auditId, approvedKeys = [], rejectedKeys = [] }) {
    const audit = await KnowledgeAudit.findById(auditId);
    if (!audit) throw new Error(`Knowledge audit not found: ${auditId}`);

    const store = getVectorStore();
    const productId = String(audit.productId);
    const approved = new Set(approvedKeys);
    const rejected = new Set(rejectedKeys);

    let applied = 0;
    let failed = 0;
    let curatedChunks = 0;
    let curatedSourceId = null;

    for (const finding of audit.findings) {
        if (rejected.has(finding.key)) {
            finding.decision = 'rejected';
            continue;
        }
        // Already-applied findings are never re-run: a second pass would
        // supersede the curated chunk it wrote the first time.
        if (!approved.has(finding.key) || finding.decision === 'applied') continue;

        try {
            if (finding.type === 'junk') {
                await store.setStatus({ ids: finding.chunkIds, status: 'excluded' });
            } else if (finding.canonicalText) {
                if (!curatedSourceId) curatedSourceId = String((await getCuratedSource(productId))._id);
                const embedding = await embed(finding.canonicalText);
                const [newChunkId] = await store.upsert([
                    {
                        productId,
                        sourceId: curatedSourceId,
                        text: finding.canonicalText,
                        embedding,
                        modality: 'text',
                        audience: finding.audience || 'general',
                        status: 'active',
                        curatedFrom: finding.chunkIds,
                        metadata: { curated: true, auditId: String(audit._id), findingKey: finding.key }
                    }
                ]);
                curatedChunks++;
                await store.setStatus({
                    ids: finding.chunkIds,
                    status: 'superseded',
                    supersededBy: newChunkId
                });
            } else {
                // No rewrite proposed: keep the authoritative chunk exactly as
                // it is and retire the rest. Cheaper and safer than paraphrasing
                // knowledge that is already correct.
                const retire = finding.chunkIds.filter((id) => String(id) !== String(finding.keepChunkId));
                if (!retire.length) {
                    finding.decision = 'applied';
                    applied++;
                    continue;
                }
                await store.setStatus({
                    ids: retire,
                    status: 'superseded',
                    supersededBy: String(finding.keepChunkId)
                });
            }
            finding.decision = 'applied';
            applied++;
        } catch (err) {
            finding.decision = 'failed';
            finding.error = err.message;
            failed++;
            Logger.error({ key: finding.key, error: err.message }, '[audit] failed to apply finding');
        }
    }

    const stillPending = audit.findings.some((f) => f.decision === 'pending');
    audit.status = stillPending ? 'ready' : 'applied';
    audit.appliedAt = new Date();
    await audit.save();

    // Retrieval caches answers for a day; without this the agent keeps quoting
    // knowledge that was just retired.
    const cacheEntriesDropped = applied > 0 ? await invalidateProductCache(productId) : 0;

    return {
        applied,
        rejected: rejectedKeys.length,
        failed,
        curatedChunks,
        cacheEntriesDropped
    };
}
