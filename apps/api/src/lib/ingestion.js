import { KnowledgeSource } from '@repo/database';
import { enqueue, QUEUES } from '@repo/queue';

/**
 * Bumps `KnowledgeSource.meta.ingestGeneration` and enqueues an
 * `ingest-source` job carrying the new value as `generation`.
 *
 * Several routes can independently request a (re-)ingestion of the SAME
 * source within a few seconds of each other — e.g. `POST /products`
 * enqueues an anonymous crawl immediately, and creating the product's
 * first agent (which resolves the crawl's synthesis language) enqueues a
 * second one moments later. The ingestion queue's worker concurrency is > 1
 * (see `apps/worker-ingestion/src/main.js`), so those two jobs can run in
 * PARALLEL and finish in EITHER order — without this, whichever one
 * happens to write last wins, which is not necessarily the more recent
 * request (observed in practice as a newly-configured language silently
 * not taking effect).
 *
 * `handleIngestSource()` re-checks this generation right before persisting
 * its result and aborts if a newer request has since superseded it, so the
 * most-recently-enqueued request always wins regardless of processing
 * order — a standard fencing-token pattern.
 *
 * @param {string|mongoose.ObjectId} sourceId
 * @param {string|mongoose.ObjectId} productId
 * @param {object} [extra] - additional job data fields (e.g. `type`)
 */
export async function enqueueIngestion(sourceId, productId, extra = {}) {
    const updated = await KnowledgeSource.findByIdAndUpdate(
        sourceId,
        { $inc: { 'meta.ingestGeneration': 1 } },
        { new: true }
    ).select('meta.ingestGeneration');

    await enqueue(QUEUES.INGESTION, 'ingest-source', {
        sourceId: String(sourceId),
        productId: String(productId),
        generation: updated?.meta?.ingestGeneration,
        ...extra
    });
}
