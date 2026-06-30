import 'dotenv/config';
import { connectDB, ShareLink, Session } from '@repo/database';
import { createWorker, QUEUES } from '@repo/queue';
import { Logger } from '@repo/logger';

async function main() {
    await connectDB();

    const worker = createWorker(QUEUES.GENERAL, async (job) => {
        switch (job.name) {
            case 'expire-links':
                await ShareLink.updateMany(
                    { expiresAt: { $lte: new Date() }, active: true },
                    { active: false }
                );
                return;
            case 'close-stale-sessions':
                await Session.updateMany(
                    {
                        status: 'live',
                        startedAt: { $lte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
                    },
                    { status: 'ended', endedAt: new Date() }
                );
                return;
            default:
                Logger.warn('Unknown general job', { name: job.name });
        }
    });

    worker.on('failed', (job, err) => Logger.error('general job failed', { id: job?.id, error: err }));
    Logger.info('worker-general ready');
}

main().catch((err) => {
    Logger.error('worker-general failed to start', { error: err });
    process.exit(1);
});
