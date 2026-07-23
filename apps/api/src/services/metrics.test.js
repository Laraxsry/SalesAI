import { describe, it, expect } from 'vitest';
import {
    routeLabel, computeJobDurationSeconds, observeSessionMetric,
    sessionJoinDurationSeconds, firstAudioLatencySeconds, toolCallDurationSeconds, sessionCostUsd
} from './metrics.js';

/**
 * routeLabel is the only pure part of the metrics middleware — it decides
 * what Prometheus label a request gets. Getting this wrong doesn't error;
 * it silently creates one time series per unique URL ever seen (e.g. one
 * per share token or agent ID), a cardinality blowup that degrades or
 * crashes Prometheus over time. Worth locking down on its own.
 */
describe('routeLabel', () => {
    it('uses the matched route pattern, not the literal URL', () => {
        const req = { baseUrl: '/api/v1/agents', route: { path: '/:id/sessions' }, path: '/api/v1/agents/64f2.../sessions' };
        expect(routeLabel(req)).toBe('/api/v1/agents/:id/sessions');
    });

    it('falls back to the raw path when no route matched (404s)', () => {
        const req = { baseUrl: '', route: undefined, path: '/no/such/route' };
        expect(routeLabel(req)).toBe('/no/such/route');
    });

    it('does not include baseUrl when there is no matched route', () => {
        const req = { baseUrl: '/api/v1/agents', route: undefined, path: '/api/v1/agents/unmatched' };
        expect(routeLabel(req)).toBe('/api/v1/agents/unmatched');
    });
});

describe('computeJobDurationSeconds', () => {
    it('computes end-to-end duration from enqueue to completion in seconds', () => {
        const job = { timestamp: 1_000, finishedOn: 3_500 };
        expect(computeJobDurationSeconds(job)).toBeCloseTo(2.5);
    });

    it('returns 0 when a job finished the instant it was enqueued', () => {
        const job = { timestamp: 1_000, finishedOn: 1_000 };
        expect(computeJobDurationSeconds(job)).toBe(0);
    });
});

/**
 * observeSessionMetric is the only pure part of the session-metrics pub/sub
 * bridge (agent-worker -> Redis -> apps/api) — it decides which histogram a
 * published observation lands in and what labels it carries. Getting the
 * unit conversion or label defaulting wrong here silently corrupts a
 * dashboard rather than throwing, so it's worth locking down independent of
 * the Redis wiring around it.
 */
describe('observeSessionMetric', () => {
    it('converts session_join_ms milliseconds to seconds with no labels', async () => {
        observeSessionMetric('session_join_ms', 1500);
        const sample = (await sessionJoinDurationSeconds.get()).values.find((v) => v.metricName?.endsWith('_sum'));
        expect(sample.value).toBeGreaterThanOrEqual(1.5);
    });

    it('records first_audio_ms under the given provider label', async () => {
        observeSessionMetric('first_audio_ms', 250, { provider: 'openai' });
        const values = (await firstAudioLatencySeconds.get()).values;
        const bucketSample = values.find((v) => v.labels.provider === 'openai' && v.labels.le === 0.25);
        expect(bucketSample.value).toBeGreaterThanOrEqual(1);
    });

    it('defaults first_audio_ms provider label to "unknown" when omitted', async () => {
        observeSessionMetric('first_audio_ms', 100);
        const values = (await firstAudioLatencySeconds.get()).values;
        expect(values.some((v) => v.labels.provider === 'unknown')).toBe(true);
    });

    it('records tool_call_ms under tool/status labels', async () => {
        observeSessionMetric('tool_call_ms', 40, { tool: 'navigate_to', status: 'ok' });
        const values = (await toolCallDurationSeconds.get()).values;
        expect(values.some((v) => v.labels.tool === 'navigate_to' && v.labels.status === 'ok')).toBe(true);
    });

    it('records session_cost_usd verbatim, with no unit conversion (already USD)', async () => {
        observeSessionMetric('session_cost_usd', 0.42);
        const sample = (await sessionCostUsd.get()).values.find((v) => v.metricName?.endsWith('_sum'));
        expect(sample.value).toBeGreaterThanOrEqual(0.42);
    });

    it('returns false and records nothing for an unrecognized metric name', async () => {
        const before = await Promise.all([
            sessionJoinDurationSeconds.get(), firstAudioLatencySeconds.get(), toolCallDurationSeconds.get(), sessionCostUsd.get()
        ]);
        const handled = observeSessionMetric('not_a_real_metric', 1);
        const after = await Promise.all([
            sessionJoinDurationSeconds.get(), firstAudioLatencySeconds.get(), toolCallDurationSeconds.get(), sessionCostUsd.get()
        ]);
        expect(handled).toBe(false);
        expect(after).toEqual(before);
    });
});
