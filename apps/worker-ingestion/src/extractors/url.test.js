import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@repo/utils', () => ({ checkSSRFUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@repo/screen', () => ({ loginWithCredentials: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

const { chromium } = await import('playwright');
const { extractFromUrl, waitForStableContent } = await import('./url.js');

describe('waitForStableContent', () => {
    it('stops polling once the content length is stable for two consecutive reads', async () => {
        const lens = [10, 25, 40, 40, 40, 999]; // grows, settles at 40 (2 consecutive matches), would grow again if not stopped
        let i = 0;
        const page = {
            evaluate: vi.fn(async () => lens[Math.min(i++, lens.length - 1)]),
            waitForTimeout: vi.fn(async () => {})
        };

        await waitForStableContent(page);

        // 10 -> 25 -> 40 -> 40 -> 40 (two consecutive equal reads => stop); the 999 read must never happen.
        expect(page.evaluate).toHaveBeenCalledTimes(5);
    });

    it(
        'gives up once the max-wait ceiling is hit if content never stabilizes',
        async () => {
            const page = {
                evaluate: vi.fn(async () => Math.floor(Math.random() * 1000)), // never repeats
                waitForTimeout: vi.fn(async () => {})
            };

            await expect(waitForStableContent(page)).resolves.toBeUndefined();
            expect(page.evaluate.mock.calls.length).toBeGreaterThan(0);
        },
        15000 // real wall-clock: CONTENT_MAX_WAIT_MS defaults to 8000ms and this never stabilizes, so it always runs the full ceiling — past vitest's 5000ms default test timeout.
    );
});

describe('extractFromUrl — previousPages cache', () => {
    /**
     * Builds a fake Playwright `page` whose `.evaluate()` branches on the
     * injected function's source: the scrape call in extractPage()
     * references `querySelectorAll` (real code), the stabilization probe in
     * waitForStableContent() doesn't — good enough to route a canned
     * response to each without needing a real DOM.
     */
    function makeFakePage(contentByUrl) {
        const page = {
            currentUrl: null,
            url: () => page.currentUrl,
            goto: vi.fn(async (url) => {
                page.currentUrl = url;
                return { status: () => 200 };
            }),
            goBack: vi.fn(async () => {}),
            $$: vi.fn(async () => []),
            waitForTimeout: vi.fn(async () => {}),
            locator: vi.fn(() => ({ first: () => ({ count: vi.fn().mockResolvedValue(0) }) })),
            evaluate: vi.fn(async (fn) => {
                const content = contentByUrl.get(page.currentUrl) || { text: '', links: [] };
                const src = fn.toString();
                // discoverClientRoutedLinks()'s nav-button candidate probe — no
                // client-routed nav buttons in these fixtures, so an empty
                // candidate list makes it a no-op without needing $$/goBack.
                if (src.includes('querySelectorAll(sel)')) return [];
                if (src.includes('.remove()')) return { text: content.text, links: content.links };
                return content.text.length;
            })
        };
        return page;
    }

    let fakePage;

    beforeEach(() => {
        fakePage = makeFakePage(
            new Map([['https://example.com/b', { text: 'raw B text', links: [] }]])
        );
        chromium.launch.mockResolvedValue({
            newContext: async () => ({ newPage: async () => fakePage }),
            close: vi.fn(async () => {})
        });
    });

    it('does not navigate to a URL already present in previousPages, and reuses its cached text/links', async () => {
        const previousPages = new Map([
            ['https://example.com/a', { rawText: 'raw A text', links: ['https://example.com/b'] }]
        ]);
        const onProgress = vi.fn();

        const result = await extractFromUrl('https://example.com/a', null, onProgress, previousPages);

        // Only the uncached page (b) triggers a real page load.
        expect(fakePage.goto).toHaveBeenCalledTimes(1);
        expect(fakePage.goto).toHaveBeenCalledWith('https://example.com/b', expect.objectContaining({ waitUntil: 'domcontentloaded' }));

        // onProgress only fires for real fetches (fetchedCount), not cache hits.
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith(1, expect.any(Number));

        const urls = result.pages.map((p) => p.url).sort();
        expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);

        expect(result.pagesIndex['https://example.com/a']).toEqual({
            rawText: 'raw A text',
            links: ['https://example.com/b']
        });
        expect(result.pagesIndex['https://example.com/b']).toEqual({ rawText: 'raw B text', links: [] });
    });

    it('fetches everything normally when previousPages is empty (first-ever crawl)', async () => {
        fakePage = makeFakePage(
            new Map([
                ['https://example.com/a', { text: 'raw A text', links: ['https://example.com/b'] }],
                ['https://example.com/b', { text: 'raw B text', links: [] }]
            ])
        );
        chromium.launch.mockResolvedValue({
            newContext: async () => ({ newPage: async () => fakePage }),
            close: vi.fn(async () => {})
        });

        const result = await extractFromUrl('https://example.com/a');

        expect(fakePage.goto).toHaveBeenCalledTimes(2);
        expect(result.pages.map((p) => p.url).sort()).toEqual(['https://example.com/a', 'https://example.com/b']);
    });
});

describe('extractFromUrl — client-routed nav discovery (no <a href>)', () => {
    it('discovers a page only reachable via a nav button click, and never clicks an action-labeled button', async () => {
        const contentByUrl = new Map([
            ['https://example.com/a', { text: 'home page', links: [] }],
            ['https://example.com/a?p=solutions', { text: 'solutions page', links: [] }]
        ]);
        // A real menu item ('Çözümlerimiz') and an action button ('Demo Talep
        // Et') that NAV_DISCOVERY_ACTION_WORDS must filter out before it's
        // ever clicked.
        const candidateTexts = ['Çözümlerimiz', 'Demo Talep Et'];
        const handle0Click = vi.fn(async () => {
            fakePage.currentUrl = 'https://example.com/a?p=solutions';
        });
        const handle1Click = vi.fn(async () => {});

        const fakePage = {
            currentUrl: null,
            url: () => fakePage.currentUrl,
            goto: vi.fn(async (url) => {
                fakePage.currentUrl = url;
                return { status: () => 200 };
            }),
            goBack: vi.fn(async () => {
                fakePage.currentUrl = 'https://example.com/a';
            }),
            $$: vi.fn(async () => [{ click: handle0Click }, { click: handle1Click }]),
            waitForTimeout: vi.fn(async () => {}),
            locator: vi.fn(() => ({ first: () => ({ count: vi.fn().mockResolvedValue(0) }) })),
            evaluate: vi.fn(async (fn) => {
                const content = contentByUrl.get(fakePage.currentUrl) || { text: '', links: [] };
                const src = fn.toString();
                // Only the root page exposes these nav candidates in this
                // fixture — the discovered page is visited too (its own
                // discoverClientRoutedLinks pass runs), but with nothing to
                // find there, keeping the click-count assertion below exact.
                if (src.includes('querySelectorAll(sel)')) {
                    return fakePage.currentUrl === 'https://example.com/a' ? candidateTexts : [];
                }
                if (src.includes('.remove()')) return { text: content.text, links: content.links };
                return content.text.length;
            })
        };

        chromium.launch.mockResolvedValue({
            newContext: async () => ({ newPage: async () => fakePage }),
            close: vi.fn(async () => {})
        });

        const result = await extractFromUrl('https://example.com/a');

        expect(handle0Click).toHaveBeenCalledTimes(1);
        expect(handle1Click).not.toHaveBeenCalled();
        expect(result.pages.map((p) => p.url).sort()).toEqual([
            'https://example.com/a',
            'https://example.com/a?p=solutions'
        ]);
    });
});
