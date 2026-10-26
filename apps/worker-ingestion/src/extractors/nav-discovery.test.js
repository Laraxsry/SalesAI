import { describe, it, expect, vi } from 'vitest';
import { discoverClientRoutedLinks, NAV_DISCOVERY_CONFIG } from './nav-discovery.js';

const ROOT = 'https://app.example';

/**
 * A fake SPA page. `items` are the nav controls in DOM order; clicking one
 * pushes its `to` route (or leaves the URL alone when `to` is null).
 */
function fakePage(items, { popup = null } = {}) {
    let url = `${ROOT}/home`;
    const clicked = [];
    const listeners = new Map();
    const context = {
        on: vi.fn((event, fn) => listeners.set(event, fn)),
        off: vi.fn((event) => listeners.delete(event))
    };
    const page = {
        context: () => context,
        url: () => url,
        // The page-side collector returns the candidates' labels in tag order.
        evaluate: vi.fn(async () => items.map((item) => item.label)),
        $: vi.fn(async (selector) => {
            const item = items[Number(selector.match(/"(\d+)"/)?.[1])];
            if (!item) return null;
            return {
                click: vi.fn(async () => {
                    clicked.push(item.label);
                    if (item.to) url = `${ROOT}${item.to}`;
                    if (popup && item.opensPopup) listeners.get('page')?.(popup);
                })
            };
        }),
        waitForTimeout: vi.fn(async () => {}),
        goBack: vi.fn(async () => { url = `${ROOT}/home`; }),
        goto: vi.fn(async () => {}),
        keyboard: { press: vi.fn(async () => {}) }
    };
    return { page, clicked, context };
}

const settle = vi.fn(async () => {});

describe('NAV_DISCOVERY_CONFIG', () => {
    it('covers app sidebars, role-based controls and route attributes', () => {
        expect(NAV_DISCOVERY_CONFIG.regions).toContain('aside');
        expect(NAV_DISCOVERY_CONFIG.controls).toContain('[role="link"]');
        const routeAttribute = new RegExp(NAV_DISCOVERY_CONFIG.routeAttribute, 'i');
        for (const name of ['data-copilot-nav-path', 'data-href', 'data-to', 'data-route', 'data-nav-url']) {
            expect(routeAttribute.test(name)).toBe(true);
        }
        for (const name of ['data-testid', 'data-state', 'class', 'data-pathology-note']) {
            expect(routeAttribute.test(name)).toBe(false);
        }
    });

    it('does not treat real hrefs as click candidates (they are read without clicking)', () => {
        expect(NAV_DISCOVERY_CONFIG.controls.join(',')).not.toContain('a[href]');
    });
});

describe('discoverClientRoutedLinks', () => {
    it('records the URL each sidebar item navigates to, and returns to the page between clicks', async () => {
        const { page, clicked } = fakePage([
            { label: 'Playbooks', to: '/playbooks' },
            { label: 'Workflows', to: '/workflows' },
            { label: 'Knowledge base', to: '/kb' }
        ]);

        const found = await discoverClientRoutedLinks(page, ROOT, { settle });

        expect(found).toEqual([
            { label: 'Playbooks', targetUrl: `${ROOT}/playbooks`, kind: 'button' },
            { label: 'Workflows', targetUrl: `${ROOT}/workflows`, kind: 'button' },
            { label: 'Knowledge base', targetUrl: `${ROOT}/kb`, kind: 'button' }
        ]);
        expect(clicked).toEqual(['Playbooks', 'Workflows', 'Knowledge base']);
        expect(page.goBack).toHaveBeenCalledTimes(3);
        expect(settle).toHaveBeenCalled();
    });

    it('never clicks side-effect or panel-action controls', async () => {
        const { page, clicked } = fakePage([
            { label: 'Publish', to: '/published' },
            { label: 'Call', to: '/call' },
            { label: 'Run', to: '/run' },
            { label: 'Upgrade', to: '/billing' },
            { label: 'Analytics', to: '/analytics' }
        ]);

        const found = await discoverClientRoutedLinks(page, ROOT, { settle });

        expect(clicked).toEqual(['Analytics']);
        expect(found.map((item) => item.label)).toEqual(['Analytics']);
    });

    it('clicks a label that appears twice only once, and skips over-long text', async () => {
        const { page, clicked } = fakePage([
            { label: 'Tools', to: '/tools' },
            { label: 'Tools', to: '/tools' },
            { label: 'A very long call to action that is clearly not a menu item at all', to: '/cta' }
        ]);

        await discoverClientRoutedLinks(page, ROOT, { settle });

        expect(clicked).toEqual(['Tools']);
    });

    it('ignores navigation to another origin and dismisses menus that do not navigate', async () => {
        const { page } = fakePage([
            { label: 'Docs', to: null },
            { label: 'Help', to: null }
        ]);
        const external = vi.spyOn(page, 'url');
        external.mockReturnValueOnce(`${ROOT}/home`);

        const found = await discoverClientRoutedLinks(page, ROOT, { settle });

        expect(found).toEqual([]);
        expect(page.keyboard.press).toHaveBeenCalledWith('Escape');
    });

    it('respects the click budget', async () => {
        const { page, clicked } = fakePage(
            Array.from({ length: 10 }, (_, i) => ({ label: `Item ${i}`, to: `/i${i}` }))
        );

        await discoverClientRoutedLinks(page, ROOT, { settle, maxClicks: 3 });

        expect(clicked).toHaveLength(3);
    });

    it('closes tabs opened by a click and always detaches its listener', async () => {
        const popup = { close: vi.fn(async () => {}) };
        const { page, context } = fakePage([{ label: 'Community', to: null, opensPopup: true }], { popup });

        await discoverClientRoutedLinks(page, ROOT, { settle });

        expect(popup.close).toHaveBeenCalledTimes(1);
        expect(context.off).toHaveBeenCalledWith('page', expect.any(Function));
    });

    it('returns an empty list when the page cannot be inspected', async () => {
        const { page } = fakePage([]);
        page.evaluate.mockRejectedValueOnce(new Error('Execution context was destroyed'));

        await expect(discoverClientRoutedLinks(page, ROOT, { settle })).resolves.toEqual([]);
    });
});
