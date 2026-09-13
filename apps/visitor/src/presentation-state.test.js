import { describe, expect, it } from 'vitest';
import { applyPresentationMessage, decodePresentationMessage, INITIAL_PRESENTATION_STATE } from './presentation-state.js';

function encoded(value) {
    return new TextEncoder().encode(JSON.stringify(value));
}

describe('presentation state', () => {
    it('decodes only presentation messages', () => {
        expect(decodePresentationMessage(encoded({ type: 'salesai:presentation', action: 'focus' })))
            .toMatchObject({ action: 'focus' });
        expect(decodePresentationMessage(encoded({ type: 'salesai:meeting' }))).toBeNull();
    });

    it('drops stale view versions and clears the active cue', () => {
        const current = applyPresentationMessage(INITIAL_PRESENTATION_STATE, {
            type: 'salesai:presentation', action: 'focus', emittedAt: 10, viewVersion: 4
        });
        expect(applyPresentationMessage(current, {
            type: 'salesai:presentation', action: 'focus', emittedAt: 11, viewVersion: 3
        })).toBe(current);
        expect(applyPresentationMessage(current, {
            type: 'salesai:presentation', action: 'clear', emittedAt: 12, viewVersion: 4
        }).cue).toBeNull();
    });
});
