import '@repo/config-env/load';
import { connectDB } from '@repo/database';
import { createWorker, QUEUES } from '@repo/queue';
import { Logger } from '@repo/logger';
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
    worker.on('failed', (job, err) => {
        Logger.error('ingestion failed', {
            id: job?.id,
            name: job?.name,
            data: job?.data,
            message: err?.message,
            stack: err?.stack
        });
    });

    Logger.info('worker-ingestion ready');
}

main().catch((err) => {
    Logger.error('worker-ingestion failed to start', { error: err });
    process.exit(1);
});
