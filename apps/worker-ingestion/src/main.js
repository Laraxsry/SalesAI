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

        // Only mark the source failed once BullMQ has exhausted all retry attempts —
        // this handler also fires after each intermediate retry.
        const sourceId = job?.data?.sourceId;
        const exhausted = job && job.attemptsMade >= (job.opts?.attempts ?? 1);
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
