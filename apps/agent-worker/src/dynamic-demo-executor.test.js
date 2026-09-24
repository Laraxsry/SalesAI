import { describe, expect, it, vi } from 'vitest';
import { createDynamicDemoExecutor } from './dynamic-demo-executor.js';

function demo(fields = {}) {
    return {
        id: 'demo_pdf',
        type: 'demo',
        objective: 'PDF alanını göster',
        pageIntent: { purpose: 'pdf_import', preferredUrl: 'https://example.test/import' },
        evidenceRefs: ['e1'],
        createdBy: 'planner',
        ...fields
    };
}

function harness(overrides = {}) {
    const navigation = { ensureAt: vi.fn(async () => ({ ok: true })) };
    const browser = {
        observe: vi.fn(async () => ({
            ok: true,
            url: 'https://example.test/import',
            snapshot: 'uid=22_1 button "Ekstre Yükle"'
        })),
        focus: vi.fn(async () => ({ ok: true })),
        perform: vi.fn(async () => ({ ok: true }))
    };
    const resolveTarget = vi.fn(() => ({
        ok: true, uid: '22_1', role: 'button', name: 'Ekstre Yükle'
    }));
    const executor = createDynamicDemoExecutor({
        navigation,
        browser,
        resolveTarget,
        ...overrides
    });
    return { executor, navigation, browser, resolveTarget };
}

const metadata = { routeRevision: 2, planningGeneration: 3 };

describe('dynamic demo executor', () => {
    it('navigates, resolves a fresh UID and focuses through the existing browser port', async () => {
        const { executor, navigation, browser, resolveTarget } = harness();
        const result = await executor.execute(demo({
            actions: [{ intent: 'focus', target: 'Ekstre Yükle', safety: 'safe' }]
        }), metadata);

        expect(result.status).toBe('completed');
        expect(navigation.ensureAt).toHaveBeenCalledWith('https://example.test/import');
        expect(resolveTarget).toHaveBeenCalledWith(expect.stringContaining('uid=22_1'), {
            target: 'Ekstre Yükle', intent: 'focus'
        });
        expect(browser.focus).toHaveBeenCalledWith('22_1', 'emphasize');
    });

    it('re-observes after a safe state-changing click', async () => {
        const { executor, browser } = harness();
        const result = await executor.execute(demo({
            actions: [{ intent: 'click', target: 'Ekstre Yükle', safety: 'safe' }]
        }), metadata);

        expect(result.status).toBe('completed');
        expect(browser.perform).toHaveBeenCalledWith('click', { uid: '22_1' });
        expect(browser.observe).toHaveBeenCalledTimes(2);
    });

    it('defends against destructive actions again at execution time', async () => {
        const { executor, browser } = harness();
        const result = await executor.execute(demo({
            actions: [{ intent: 'click', target: 'Sil', safety: 'destructive' }]
        }), metadata);

        expect(result).toMatchObject({ status: 'failed', reason: 'destructive_action_rejected' });
        expect(browser.perform).not.toHaveBeenCalledWith('click', expect.anything());
    });

    it('cancels after navigation when the customer interrupts', async () => {
        let finishNavigation;
        const navigation = {
            ensureAt: vi.fn(() => new Promise((resolve) => { finishNavigation = resolve; }))
        };
        const { executor, browser } = harness({ navigation });
        const pending = executor.execute(demo(), metadata);
        executor.cancel('customer_interrupted');
        finishNavigation({ ok: true });

        await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
        expect(browser.observe).not.toHaveBeenCalled();
    });

    it('refuses execution from a stale route revision', async () => {
        const { executor, navigation } = harness({ isCurrent: () => false });
        await expect(executor.execute(demo(), metadata)).resolves
            .toMatchObject({ status: 'cancelled', reason: 'stale_route' });
        expect(navigation.ensureAt).not.toHaveBeenCalled();
    });
});
