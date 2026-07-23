import { describe, it, expect, beforeAll } from 'vitest';
import { context as otelContext, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { extractParentContext } from './trace-context.js';

describe('extractParentContext', () => {
    // The real process registers this via NodeSDK's tracing.js bootstrap;
    // outside that bootstrap, @opentelemetry/api's inject/extract are no-ops.
    beforeAll(() => {
        propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    });

    it('returns the current active context when metadata is missing', () => {
        const result = extractParentContext(undefined);
        expect(result).toBe(otelContext.active());
    });

    it('returns the current active context when metadata has no __traceContext', () => {
        const result = extractParentContext({ metadata: JSON.stringify({ sessionId: 'abc' }) });
        expect(result).toBe(otelContext.active());
    });

    it('returns the current active context when metadata is malformed JSON', () => {
        const result = extractParentContext({ metadata: '{not-json' });
        expect(result).toBe(otelContext.active());
    });

    it('extracts a span context propagated via __traceContext', () => {
        const carrier = {};
        const fakeSpanContext = {
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            traceFlags: 1
        };
        const injectedContext = trace.setSpanContext(otelContext.active(), fakeSpanContext);
        propagation.inject(injectedContext, carrier);

        const job = { metadata: JSON.stringify({ sessionId: 'abc', __traceContext: carrier }) };
        const extracted = extractParentContext(job);
        const extractedSpanContext = trace.getSpanContext(extracted);

        expect(extractedSpanContext?.traceId).toBe(fakeSpanContext.traceId);
    });
});
