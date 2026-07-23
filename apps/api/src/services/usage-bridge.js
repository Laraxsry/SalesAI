import IORedis from 'ioredis';
import { USAGE_CHANNEL } from '@repo/realtime';
import { Logger } from '@repo/logger';
import { recordUsage } from './billing-service.js';

/**
 * Subscribes to usage observations published by agent-worker processes
 * (Phase 7 cost tracking) and relays each one into the real Phase 6 billing
 * ledger via `recordUsage()`. A thin cross-process bridge, not a second
 * source of truth — `recordUsage()`/`UsageRecord`/`Subscription` remain the
 * one authoritative usage-metering path; agent-worker can't call it directly
 * since it lives in this app, not a shared package.
 *
 * Returns the Redis subscriber connection so the caller can `.quit()` it
 * during graceful shutdown.
 */
export function subscribeUsageEvents() {
    const sub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    });
    sub.on('error', () => {});
    sub.subscribe(USAGE_CHANNEL).catch((err) => {
        Logger.error('failed to subscribe to usage channel', { error: err.message });
    });
    sub.on('message', (channel, raw) => {
        if (channel !== USAGE_CHANNEL) return;
        let usage;
        try {
            usage = JSON.parse(raw);
        } catch {
            return; // malformed — ignore
        }
        recordUsage(usage).catch((err) => {
            Logger.error('failed to record usage published by agent-worker', { error: err.message, usage });
        });
    });
    return sub;
}
