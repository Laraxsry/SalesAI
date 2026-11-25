import { describe, expect, it } from 'vitest';
import { applyFeedback, isFeedbackOpen, FEEDBACK_WINDOW_MS, MAX_FEEDBACK_ENTRIES } from './session-feedback.js';

describe('session feedback', () => {
    it('appends a new visitor and replaces a returning one', () => {
        const first = applyFeedback([], { rating: 4, visitorKey: 'a' });
        const second = applyFeedback(first, { rating: 2, visitorKey: 'b' });
        const updated = applyFeedback(second, { rating: 5, comment: 'Harika', visitorKey: 'a' });
        expect(updated.map((e) => [e.visitorKey, e.rating])).toEqual([['a', 5], ['b', 2]]);
        expect(updated[0].comment).toBe('Harika');
    });

    it('treats ratings without a visitorKey as separate entries', () => {
        const entries = applyFeedback(applyFeedback([], { rating: 3 }), { rating: 4 });
        expect(entries).toHaveLength(2);
    });

    it('stops growing at the cap but still lets a known visitor update', () => {
        const full = Array.from({ length: MAX_FEEDBACK_ENTRIES }, (_, i) => ({ rating: 3, visitorKey: `v${i}` }));
        expect(applyFeedback(full, { rating: 5, visitorKey: 'new' })).toBeNull();
        expect(applyFeedback(full, { rating: 5, visitorKey: 'v0' })[0].rating).toBe(5);
    });

    it('closes the rating window a week after the call started', () => {
        const startedAt = new Date('2026-01-01T10:00:00Z');
        expect(isFeedbackOpen({ startedAt }, startedAt.getTime() + FEEDBACK_WINDOW_MS)).toBe(true);
        expect(isFeedbackOpen({ startedAt }, startedAt.getTime() + FEEDBACK_WINDOW_MS + 1)).toBe(false);
    });
});
