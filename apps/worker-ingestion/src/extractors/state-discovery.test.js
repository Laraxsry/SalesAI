import { describe, expect, it, vi } from 'vitest';
import { diffSnapshots, peekAtButtons } from './state-discovery.js';

const control = (label, kind = 'button') => ({ label, kind });
const snapshot = ({ url = 'https://app.example/page', controls = [], overlays = [] } = {}) => ({ url, controls, overlays });

describe('diffSnapshots', () => {
    it('reports a dialog that was not there before, with the controls it brought', () => {
        const before = snapshot({ controls: [control('Create workflow')] });
        const after = snapshot({
            controls: [control('Create workflow'), control('Cancel'), control('Create')],
            overlays: [{ kind: 'dialog', title: 'New workflow', text: 'Name', elements: [control('Cancel'), control('Create')] }]
        });

        const diff = diffSnapshots(before, after);

        expect(diff.overlays).toHaveLength(1);
        expect(diff.overlays[0].title).toBe('New workflow');
        expect(diff.newElements.map((item) => item.label)).toEqual(['Cancel', 'Create']);
        expect(diff.urlChanged).toBe(false);
    });

    it('does not report a dialog that was already open', () => {
        const dialog = { kind: 'dialog', title: 'Welcome', text: 'Hi', elements: [] };
        const diff = diffSnapshots(snapshot({ overlays: [dialog] }), snapshot({ overlays: [dialog] }));

        expect(diff.overlays).toEqual([]);
    });

    it('treats a #section jump on the same page as no navigation', () => {
        const diff = diffSnapshots(
            snapshot({ url: 'https://app.example/page' }),
            snapshot({ url: 'https://app.example/page#section' })
        );

        expect(diff.urlChanged).toBe(false);
    });

    it('reports a different path as a navigation', () => {
        const diff = diffSnapshots(snapshot(), snapshot({ url: 'https://app.example/templates' }));

        expect(diff.urlChanged).toBe(true);
    });

    it('caps how many new controls it lists', () => {
        const many = Array.from({ length: 40 }, (_, i) => control(`Item ${i}`));

        const diff = diffSnapshots(snapshot(), snapshot({ controls: many }), { maxNewElements: 10 });

        expect(diff.newElements).toHaveLength(10);
    });
});

describe('peekAtButtons', () => {
    const settle = vi.fn(async () => {});

    it('returns nothing when the page cannot be inspected', async () => {
        const page = {
            url: () => 'https://app.example/page',
            evaluate: vi.fn().mockRejectedValue(new Error('Execution context was destroyed'))
        };

        await expect(peekAtButtons(page, 'https://app.example/page', { settle })).resolves.toEqual({ states: [], links: [] });
    });

    it('never presses panel actions, however they are labelled in the page', async () => {
        const clicked = [];
        const page = {
            url: () => 'https://app.example/page',
            // collect() -> labels; snapshot() -> a plain snapshot; countOverlays -> 0.
            evaluate: vi.fn(async (fn) => {
                if (fn.name === 'collectPeekCandidates') return ['Publish', 'Delete', 'Run', 'Upgrade', 'Edit view'];
                if (fn.name === 'countOverlays') return 0;
                return snapshot();
            }),
            $: vi.fn(async (selector) => ({ click: vi.fn(async () => { clicked.push(selector); }) })),
            waitForTimeout: vi.fn(async () => {}),
            goto: vi.fn(async () => {}),
            keyboard: { press: vi.fn(async () => {}) }
        };

        await peekAtButtons(page, 'https://app.example/page', { settle });

        // Only the harmless "Edit view" is pressed.
        expect(clicked).toHaveLength(1);
    });

    // Real finding: after a reload-restore the quick wait accepted a loading skeleton, so the
    // page text was read half drawn (154 characters instead of ~1900).
    it('waits through the injected settle after it has to reload the page to restore it', async () => {
        const order = [];
        const page = {
            url: () => 'https://app.example/page',
            evaluate: vi.fn(async (fn) => {
                if (fn.name === 'collectPeekCandidates') return ['Stuck panel'];
                if (fn.name === 'countOverlays') return 1; // never closes
                return snapshot();
            }),
            $: vi.fn(async () => ({ click: vi.fn(async () => {}) })),
            waitForTimeout: vi.fn(async () => {}),
            goto: vi.fn(async () => { order.push('goto'); }),
            keyboard: { press: vi.fn(async () => {}) }
        };
        const patientSettle = vi.fn(async () => { order.push('settle'); });

        await peekAtButtons(page, 'https://app.example/page', { settle: patientSettle });

        expect(order).toEqual(['goto', 'settle']);
    });

    it('respects the press budget', async () => {
        const clicked = [];
        const labels = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
        const page = {
            url: () => 'https://app.example/page',
            evaluate: vi.fn(async (fn) => {
                if (fn.name === 'collectPeekCandidates') return labels;
                if (fn.name === 'countOverlays') return 0;
                return snapshot();
            }),
            $: vi.fn(async () => ({ click: vi.fn(async () => { clicked.push(1); }) })),
            waitForTimeout: vi.fn(async () => {}),
            goto: vi.fn(async () => {}),
            keyboard: { press: vi.fn(async () => {}) }
        };

        await peekAtButtons(page, 'https://app.example/page', { settle, maxPeeks: 3 });

        expect(clicked).toHaveLength(3);
    });
});
