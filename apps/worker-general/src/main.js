import '@repo/config-env/load';
import { connectDB, ShareLink, Session, Agent } from '@repo/database';
import { createWorker, getQueue, QUEUES } from '@repo/queue';
import { Logger } from '@repo/logger';
import { analyzeSession } from './handlers/analyze-session.js';
import { rollupAnalytics } from './handlers/rollup-analytics.js';

async function main() {
    await connectDB();

    const generalQueue = getQueue(QUEUES.GENERAL);

    // Schedule repetitive maintenance jobs
    await generalQueue.add('expire-links', {}, {
        repeat: { pattern: '* * * * *' }, // every minute
        jobId: 'cron-expire-links'
    });
    
    await generalQueue.add('close-stale-sessions', {}, {
        repeat: { pattern: '*/5 * * * *' }, // every 5 minutes
        jobId: 'cron-close-stale-sessions'
    });

    // Phase 4: Saatlik AnalyticsRollup — her saat başı çalışır
    await generalQueue.add('rollup-hourly', {}, {
        repeat: { pattern: '0 * * * *' }, // her saat başı
        jobId: 'cron-rollup-hourly'
    });

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

            // Phase 4: Post-call analiz
            // Tetikleyici: session biterken sessions.js veya agent-worker'dan
            //   enqueue(QUEUES.GENERAL, 'analyze-session', { sessionId })
            // Mimari: 01_architecture.md — API → enqueue → BullMQ → worker-general
            case 'analyze-session':
                await analyzeSession(job.data);
                return;

            // Phase 4: Saatlik rollup — tüm aktif agent'lar için
            case 'rollup-hourly': {
                const bucketAt = new Date();
                bucketAt.setMinutes(0, 0, 0); // saat başına yuvarla

                const agents = await Agent.find({ status: 'active' }, '_id productId').lean();
                for (const agent of agents) {
                    await rollupAnalytics({
                        scope: 'agent',
                        scopeId: String(agent._id),
                        bucket: 'hour',
                        bucketAt
                    });
                    if (agent.productId) {
                        await rollupAnalytics({
                            scope: 'product',
                            scopeId: String(agent.productId),
                            bucket: 'hour',
                            bucketAt
                        });
                    }
                }
                return;
            }

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
