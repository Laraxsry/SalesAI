import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, getBreaker, _resetRegistry } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
    it('starts closed and allows calls', () => {
        const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
        expect(breaker.getState()).toBe('closed');
        expect(breaker.canAttempt()).toBe(true);
    });

    it('stays closed on failures below the threshold', () => {
        const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
        breaker.onFailure();
        breaker.onFailure();
        expect(breaker.getState()).toBe('closed');
        expect(breaker.canAttempt()).toBe(true);
    });

    it('opens once the failure threshold is reached, and blocks calls', () => {
        const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
        breaker.onFailure();
        breaker.onFailure();
        breaker.onFailure();
        expect(breaker.getState()).toBe('open');
        expect(breaker.canAttempt()).toBe(false);
    });

    it('a success resets the failure count and keeps the circuit closed', () => {
        const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
        breaker.onFailure();
        breaker.onFailure();
        breaker.onSuccess();
        breaker.onFailure();
        breaker.onFailure();
        // Would have opened at the 3rd cumulative failure if the counter
        // hadn't been reset by onSuccess() in between.
        expect(breaker.getState()).toBe('closed');
    });

    describe('cooldown / half-open', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('stays open until resetTimeoutMs elapses', () => {
            const breaker = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 1000 });
            breaker.onFailure();
            expect(breaker.canAttempt()).toBe(false);

            vi.advanceTimersByTime(999);
            expect(breaker.canAttempt()).toBe(false);

            vi.advanceTimersByTime(1);
            expect(breaker.canAttempt()).toBe(true);
            expect(breaker.getState()).toBe('half-open');
        });

        it('a successful half-open probe fully closes the circuit', () => {
            const breaker = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 1000 });
            breaker.onFailure();
            vi.advanceTimersByTime(1000);
            breaker.canAttempt(); // transitions to half-open
            breaker.onSuccess();
            expect(breaker.getState()).toBe('closed');
        });

        it('a failed half-open probe re-opens immediately (no fresh threshold needed)', () => {
            const breaker = new CircuitBreaker('test', { failureThreshold: 5, resetTimeoutMs: 1000 });
            for (let i = 0; i < 5; i++) breaker.onFailure();
            vi.advanceTimersByTime(1000);
            breaker.canAttempt(); // transitions to half-open
            breaker.onFailure(); // single failure, not 5
            expect(breaker.getState()).toBe('open');
            expect(breaker.canAttempt()).toBe(false);
        });
    });
});

describe('getBreaker (shared registry)', () => {
    afterEach(() => _resetRegistry());

    it('returns the same breaker instance for the same key', () => {
        const a = getBreaker('llm:openai');
        const b = getBreaker('llm:openai');
        expect(a).toBe(b);
    });

    it('returns independent breakers for different keys', () => {
        const a = getBreaker('llm:openai', { failureThreshold: 1 });
        const b = getBreaker('llm:anthropic', { failureThreshold: 1 });
        a.onFailure();
        expect(a.getState()).toBe('open');
        expect(b.getState()).toBe('closed');
    });
});
