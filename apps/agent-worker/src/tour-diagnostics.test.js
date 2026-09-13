import { describe, expect, it, vi } from 'vitest';
import { createTourChoreographer } from './tour-choreographer.js';
import { createPresentationCuePublisher } from './presentation-cues.js';
import { tourActionMeta } from './tour-diagnostics.js';

const geometry = { x: 0.2, y: 0.3, width: 0.1, height: 0.1 };

describe('tour monitoring', () => {
    it('correlates geometry, cursor, click and publication with the browser operation', async () => {
        const events = [];
        const participant = { publishData: vi.fn(async () => {}) };
        const publishCue = createPresentationCuePublisher({ participant,
            onEvent: (event, meta) => events.push({ source: 'publish', event, ...meta }) });
        const choreography = createTourChoreographer({
            browser: { describeElement: async () => ({ geometry }) }, publishCue,
            wait: async () => {}, onEvent: (event, meta) => events.push({ source: 'choreography', event, ...meta })
        });
        await choreography.beforeAction('click', { uid: '1_2' }, 'browser-7');
        expect(events.filter(e => e.event === 'step.begin').map(e => e.stage))
            .toEqual(['geometry', 'cursor_move', 'wait', 'click', 'wait']);
        expect(events.filter(e => e.source === 'publish' && e.event === 'end')).toEqual([
            expect.objectContaining({ operationId: 'browser-7', cueId: 'presentation-1', action: 'cursor_move', status: 'published' }),
            expect.objectContaining({ operationId: 'browser-7', cueId: 'presentation-2', action: 'click', status: 'published' })
        ]);
        expect(events.at(-1)).toMatchObject({ event: 'action.end', operationId: 'browser-7', decorated: true });
    });

    it('records swallowed geometry failures and skips without blocking real actions', async () => {
        const onEvent = vi.fn();
        const choreography = createTourChoreographer({
            browser: { describeElement: async () => { throw new Error('stale UID'); } },
            publishCue: vi.fn(), onEvent
        });
        await expect(choreography.beforeAction('click', { uid: 'old' })).resolves.toEqual({ decorated: false });
        expect(onEvent).toHaveBeenCalledWith('step.end', expect.objectContaining({ stage: 'geometry', status: 'error', error: 'stale UID' }));
        await choreography.beforeAction('fill', { uid: 'field', value: 'private-value' });
        expect(onEvent).toHaveBeenLastCalledWith('action.end', expect.objectContaining({ reason: 'unsupported_action' }));
        expect(JSON.stringify(onEvent.mock.calls)).not.toContain('private-value');
    });

    it('preserves publish failure and reports its cue ID', async () => {
        const onEvent = vi.fn();
        const publish = createPresentationCuePublisher({ onEvent,
            participant: { publishData: async () => { throw new Error('disconnected'); } } });
        await expect(publish({ action: 'clear' })).rejects.toThrow('disconnected');
        expect(onEvent).toHaveBeenLastCalledWith('end', expect.objectContaining({ cueId: 'presentation-1', status: 'error', error: 'disconnected' }));
    });

    it('keeps working if monitoring throws or rejects', async () => {
        const publishCue = createPresentationCuePublisher({
            participant: { publishData: async () => {} }, onEvent: async () => { throw new Error('observer'); }
        });
        const choreography = createTourChoreographer({
            browser: { describeElement: async () => ({ geometry }) }, publishCue, wait: async () => {},
            onEvent: () => { throw new Error('observer'); }
        });
        await expect(choreography.beforeAction('click', { uid: '1_2' })).resolves.toMatchObject({ decorated: true });
    });

    it('does not log arbitrary typed keys or form arguments', () => {
        expect(tourActionMeta('pressKey', { key: 'password', value: 'private', url: 'https://private' }))
            .toEqual({ action: 'pressKey', uid: null, key: '[redacted]' });
    });
});
