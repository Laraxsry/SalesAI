import '@repo/config-env/load';
import { connectDB, KnowledgeSource } from '@repo/database';
import { createWorker, QUEUES } from '@repo/queue';
import { Logger } from '@repo/logger';
import { publishEvent, RT_EVENTS } from '@repo/realtime';
import { handleIngestSource } from './handlers/ingest-source.js';

async function main() {
    await connectDB();

    const worker = createWorker(
        QUEUES.INGESTION,
        async (job) => {
            switch (job.name) {
                case 'ingest-source':
                    return handleIngestSource(job.data);
                default:
                    Logger.warn('Unknown ingestion job', { name: job.name });
            }
        },
        { concurrency: Number(process.env.INGESTION_CONCURRENCY || 3) }
    );

    worker.on('completed', (job) => Logger.info('ingestion completed', { id: job.id }));
    worker.on('failed', async (job, err) => {
        Logger.error('ingestion failed', {
            id: job?.id,
            name: job?.name,
            data: job?.data,
            message: err?.message,
            stack: err?.stack
        });

        // Only mark the source failed once this failure is actually terminal —
        // this handler also fires after each intermediate retry that will
        // still be reprocessed, so a naive "always sync" would flip status to
        // 'failed' for a job about to succeed on attempt 2.
        //
        // `attemptsMade >= attempts` catches an ordinary retry cycle running
        // out. It does NOT catch a job BullMQ gives up on via its OWN stalled-
        // job detection ("job stalled more than allowable limit" — the worker
        // holding the lock died, e.g. a dev-server restart mid-job): that path
        // moves the job straight to permanently 'failed' without ever
        // incrementing attemptsMade through the normal retry mechanism, so a
        // job stalled on its very first attempt (attemptsMade:1 of 3) looked
        // "not exhausted" here and the source was left stuck at its last
        // real status forever — observed live on two separate sources whose
        // worker died mid-crawl/mid-zip, both showing "pending"/"processing"
        // in the Console with no way to tell they had actually failed.
        // `job.finishedOn` is BullMQ's own signal for "this job's outcome is
        // final, it will not be retried" regardless of which path got it
        // there — checking that in addition covers both.
        const sourceId = job?.data?.sourceId;
        const exhausted = Boolean(job) && (Boolean(job.finishedOn) || job.attemptsMade >= (job.opts?.attempts ?? 1));
        if (sourceId && exhausted) {
            await KnowledgeSource.findByIdAndUpdate(sourceId, {
                status: 'failed',
                error: err?.message || 'Ingestion failed'
            }).catch(() => {});
            await publishEvent(RT_EVENTS.INGESTION_PROGRESS, {
                sourceId,
                stage: 'Başarısız',
                pct: 100
            }).catch(() => {});
        }
    });

    Logger.info('worker-ingestion ready');
}

main().catch((err) => {
    Logger.error('worker-ingestion failed to start', { error: err });
    process.exit(1);
});
