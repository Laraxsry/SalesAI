import { describe, it, expect, vi } from 'vitest';
import { withPlaybookProgress } from './playbook-progress.js';

/**
 * `navigate_to`/`scroll_page`/`highlight` are mid-narration moves the model
 * uses constantly while still explaining a page — the one thing this
 * decorator must never do is treat any of them as "this step is done".
 * Getting that wrong races the presentation past a step it has barely
 * started, which is worse than the timer never firing at all.
 */

function currentNodeReturning(node) {
    return vi.fn(() => node);
}

describe('withPlaybookProgress — contract preservation', () => {
    it('preserves the handler return value', async () => {
        const toolDefs = [{ name: 'search_knowledge', handler: async () => ({ ok: true, answer: 42 }) }];
        const [wrapped] = withPlaybookProgress(toolDefs, {
            currentNode: currentNodeReturning(null),
            onGoalReached: vi.fn()
        });

        await expect(wrapped.handler({ query: 'x' })).resolves.toEqual({ ok: true, answer: 42 });
    });

    it('forwards all arguments to the original handler', async () => {
        const handler = vi.fn(async (arg) => arg);
        const [wrapped] = withPlaybookProgress([{ name: 'click_element', handler }], {
            currentNode: currentNodeReturning(null),
            onGoalReached: vi.fn()
        });

        await wrapped.handler({ selector: 'text=Kaydet' });

        expect(handler).toHaveBeenCalledWith({ selector: 'text=Kaydet' });
    });

    it('rethrows when the handler throws, without ever signaling progress', async () => {
        const boom = new Error('boom');
        const toolDefs = [{ name: 'click_element', handler: async () => { throw boom; } }];
        const onGoalReached = vi.fn();
        const [wrapped] = withPlaybookProgress(toolDefs, {
            currentNode: currentNodeReturning({ attach: 'Rapor Ekle butonu' }),
            onGoalReached
        });

        await expect(wrapped.handler({ selector: 'text=Rapor Ekle' })).rejects.toThrow('boom');
        expect(onGoalReached).not.toHaveBeenCalled();
    });
});

describe('withPlaybookProgress — click_element on an attach node', () => {
    it('signals progress when click_element succeeds and the current node has an attach target', async () => {
        const toolDefs = [{ name: 'click_element', handler: async () => ({ ok: true }) }];
        const onGoalReached = vi.fn();
        const [wrapped] = withPlaybookProgress(toolDefs, {
            currentNode: currentNodeReturning({ attach: 'Rapor Ekle butonu' }),
            onGoalReached
        });

        await wrapped.handler({ selector: 'text=Rapor Ekle' });

        expect(onGoalReached).toHaveBeenCalledTimes(1);
        expect(onGoalReached).toHaveBeenCalledWith('click_element');
    });

    it('does not signal when the current node has no attach target', async () => {
        const toolDefs = [{ name: 'click_element', handler: async () => ({ ok: true }) }];
        const onGoalReached = vi.fn();
        const [wrapped] = withPlaybookProgress(toolDefs, {
            currentNode: currentNodeReturning({ attach: null }),
            onGoalReached
        });

        await wrapped.handler({ selector: 'text=Menü' });

        expect(onGoalReached).not.toHaveBeenCalled();
    });

    it('does not signal when there is no current node (no playbook running)', async () => {
        const toolDefs = [{ name: 'click_element', handler: async () => ({ ok: true }) }];
        const onGoalReached = vi.fn();
        const [wrapped] = withPlaybookProgress(toolDefs, {
            currentNode: currentNodeReturning(null),
            onGoalReached
        });

        await wrapped.handler({ selector: 'text=Menü' });

        expect(onGoalReached).not.toHaveBeenCalled();
    });

    it('does not signal when click_element fails ({ ok: false })', async () => {
        const toolDefs = [{ name: 'click_element', handler: async () => ({ ok: false, error: 'element not found' }) }];
        const onGoalReached = vi.fn();
        const [wrapped] = withPlaybookProgress(toolDefs, {
            currentNode: currentNodeReturning({ attach: 'Rapor Ekle butonu' }),
            onGoalReached
        });

        await wrapped.handler({ selector: 'text=Rapor Ekle' });

        expect(onGoalReached).not.toHaveBeenCalled();
    });
});

describe('withPlaybookProgress — never signals for mid-narration tools', () => {
    it.each(['navigate_to', 'scroll_page', 'highlight', 'start_guided_tour', 'read_tour_screen'])(
        '%s never signals progress, even on a node with an attach target',
        async (toolName) => {
            const toolDefs = [{ name: toolName, handler: async () => ({ ok: true }) }];
            const onGoalReached = vi.fn();
            const [wrapped] = withPlaybookProgress(toolDefs, {
                currentNode: currentNodeReturning({ attach: 'Rapor Ekle butonu' }),
                onGoalReached
            });

            await wrapped.handler({});

            expect(onGoalReached).not.toHaveBeenCalled();
        }
    );
});
