import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@repo/utils', async (importOriginal) => ({
    ...(await importOriginal()),
    checkSSRFUrl: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@repo/screen', () => ({ loginWithCredentials: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

const { chromium } = await import('playwright');
const { extractFromUrl, waitForStableContent, extractPageComponents, discoverTabVariants, discoverToggleVariants } =
    await import('./url.js');

const EMPTY_COMPONENTS = { headings: [], interactiveElements: [], sections: [] };

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
                // discoverTabVariants' read-only group probe — no tab/panel
                // button groups in these fixtures, so it's a no-op.
                if (src.includes("closest('nav, header')")) return [];
                if (src.includes('h1, h2, h3, h4, h5, h6')) return EMPTY_COMPONENTS;
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
            ['https://example.com/a', { indexVersion: 2, rawText: 'raw A text', links: ['https://example.com/b'] }]
        ]);
        const onProgress = vi.fn();

        const result = await extractFromUrl('https://example.com/a', null, onProgress, previousPages);

        // Only the uncached page (b) triggers a real page load — 2 gotos for
        // it: extractPage's own navigation, plus discoverTabVariants' own
        // defensive reload before group detection (see its docstring).
        expect(fakePage.goto).toHaveBeenCalledTimes(2);
        expect(fakePage.goto).toHaveBeenCalledWith('https://example.com/b', expect.objectContaining({ waitUntil: 'domcontentloaded' }));

        // onProgress only fires for real fetches (fetchedCount), not cache hits,
        // and carries the running pagesIndex so a caller can checkpoint it —
        // this is what lets a retry resume instead of re-crawling everything.
        expect(onProgress).toHaveBeenCalledTimes(1);
        const [, , pagesIndexSoFar] = onProgress.mock.calls[0];
        expect(pagesIndexSoFar['https://example.com/b'].rawText).toBe('raw B text');

        const urls = result.pages.map((p) => p.url).sort();
        expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);

        // Cache-hit page: passed through from previousPages verbatim, no
        // parentUrl added (that field didn't exist when this cache entry —
        // the legacy plain-string-links shape — was written).
        expect(result.pagesIndex['https://example.com/a']).toEqual({
            indexVersion: 2,
            rawText: 'raw A text',
            links: ['https://example.com/b']
        });
        // Freshly-fetched page: gets the site-structure-tree's parentUrl —
        // the page it was discovered from (the root, here) — and a
        // (here empty, per the fixture's fake DOM) components inventory.
        expect(result.pagesIndex['https://example.com/b']).toEqual({
            indexVersion: 2,
            rawText: 'raw B text',
            links: [],
            parentUrl: 'https://example.com/a',
            components: EMPTY_COMPONENTS
        });
    });

    it('re-fetches a legacy page index once so newly-added element discovery is populated', async () => {
        fakePage = makeFakePage(
            new Map([['https://example.com/a', { text: 'fresh A text', links: [] }]])
        );
        chromium.launch.mockResolvedValue({
            newContext: async () => ({ newPage: async () => fakePage }),
            close: vi.fn(async () => {})
        });
        const previousPages = new Map([
            ['https://example.com/a', { rawText: 'stale A text', links: [] }]
        ]);

        const result = await extractFromUrl('https://example.com/a', null, null, previousPages);

        expect(fakePage.goto).toHaveBeenCalledTimes(2);
        expect(result.pages[0].text).toBe('fresh A text');
        expect(result.pagesIndex['https://example.com/a'].indexVersion).toBe(2);
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

        // 2 fetched pages × 2 gotos each (extractPage's own navigation, plus
        // discoverTabVariants' defensive reload — see the test above).
        expect(fakePage.goto).toHaveBeenCalledTimes(4);
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
                if (src.includes("closest('nav, header')")) return [];
                if (src.includes('h1, h2, h3, h4, h5, h6')) return EMPTY_COMPONENTS;
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

        // Site-structure tree: the discovered page's button (not a bare URL)
        // shows up on the page it was clicked from, carrying the button's own
        // label — and the discovered page itself records that page as its parent.
        expect(result.pagesIndex['https://example.com/a'].links).toContainEqual({
            label: 'Çözümlerimiz',
            targetUrl: 'https://example.com/a?p=solutions',
            kind: 'button'
        });
        expect(result.pagesIndex['https://example.com/a?p=solutions'].parentUrl).toBe('https://example.com/a');
        expect(result.pagesIndex['https://example.com/a'].parentUrl).toBeNull();
    });
});

describe('extractPageComponents', () => {
    /** Minimal fake DOM element — only the members extractPageComponents reads. */
    function fakeEl({ tag, text = '', ariaLabel = null, value = null, matches = () => false }) {
        return {
            tagName: tag.toUpperCase(),
            textContent: text,
            value,
            getAttribute: (name) => (name === 'aria-label' ? ariaLabel : null),
            matches
        };
    }

    afterEach(() => {
        delete global.document;
    });

    it('extracts headings, interactive elements (as text=<label> selectors), and landmark sections', async () => {
        const h1 = fakeEl({ tag: 'h1', text: 'Ana Başlık' });
        const h2 = fakeEl({ tag: 'h2', text: 'Alt Başlık' });
        const button = fakeEl({ tag: 'button', text: 'İletişime Geç' });
        const link = fakeEl({ tag: 'a', text: 'Fiyatlandırma' });
        const submit = fakeEl({ tag: 'button', text: 'Gönder', matches: (sel) => sel.includes('submit') });
        const form = fakeEl({ tag: 'form', text: 'Ad Soyad E-posta Gönder' });
        const section = fakeEl({ tag: 'section', text: 'Planlarımız hakkında bilgi', ariaLabel: 'Fiyatlandırma bölümü' });

        global.document = {
            querySelectorAll: (selector) => {
                if (selector === 'h1, h2, h3, h4, h5, h6') return [h1, h2];
                if (selector.startsWith('button, a[href]')) return [button, link, submit];
                if (selector === 'form, section, [aria-label]') return [form, section];
                return [];
            }
        };

        // Real Playwright serializes fn+args across the browser boundary;
        // here we just invoke it directly against the fake `document` above.
        const page = { evaluate: (fn, args) => fn(args) };

        const result = await extractPageComponents(page);

        expect(result.headings).toEqual([
            { level: 1, text: 'Ana Başlık' },
            { level: 2, text: 'Alt Başlık' }
        ]);
        expect(result.interactiveElements).toContainEqual({
            label: 'İletişime Geç',
            kind: 'button',
            selector: 'text=İletişime Geç'
        });
        expect(result.interactiveElements).toContainEqual({
            label: 'Fiyatlandırma',
            kind: 'link',
            selector: 'text=Fiyatlandırma'
        });
        expect(result.interactiveElements).toContainEqual({
            label: 'Gönder',
            kind: 'submit',
            selector: 'text=Gönder'
        });
        expect(result.sections.find((s) => s.tag === 'section').ariaLabel).toBe('Fiyatlandırma bölümü');
    });

    it('caps interactive elements at MAX_INTERACTIVE_ELEMENTS_PER_PAGE and skips overly-long labels', async () => {
        const manyButtons = Array.from({ length: 70 }, (_, i) => fakeEl({ tag: 'button', text: `Buton ${i}` }));
        const tooLong = fakeEl({ tag: 'button', text: 'x'.repeat(200) });

        global.document = {
            querySelectorAll: (selector) => {
                if (selector.startsWith('button, a[href]')) return [...manyButtons, tooLong];
                return [];
            }
        };
        const page = { evaluate: (fn, args) => fn(args) };

        const result = await extractPageComponents(page);

        expect(result.interactiveElements.length).toBe(60);
        expect(result.interactiveElements.some((el) => el.label.length > 80)).toBe(false);
    });

    it('resolves to empty arrays (non-fatal) if page.evaluate throws', async () => {
        const page = { evaluate: vi.fn().mockRejectedValue(new Error('boom')) };
        await expect(extractPageComponents(page)).resolves.toEqual(EMPTY_COMPONENTS);
    });
});

describe('discoverTabVariants', () => {
    /** Minimal fake DOM button — only what detectTabGroupLabels reads. */
    function fakeButton({ text, parent, inNav = false }) {
        return {
            textContent: text,
            parentElement: parent,
            closest: () => (inNav ? {} : null)
        };
    }

    /**
     * Builds a fake Playwright `page` whose `.evaluate()` runs the real
     * injected function directly against a fake `document` (same pattern as
     * the extractPageComponents tests above), and whose `.goto`/`.click`
     * just track calls without touching `buttons` — the DOM fixture is
     * static across the whole test, only the call sequence is asserted.
     */
    function makeFakePage(buttons) {
        global.document = {
            body: { innerText: 'panel content' },
            querySelectorAll: (sel) => (sel === 'button, [role="button"]' ? buttons : [])
        };
        const calls = [];
        return {
            calls,
            evaluate: async (fn, args) => fn(args),
            waitForTimeout: vi.fn(async () => {}),
            goto: vi.fn(async (url) => {
                calls.push({ type: 'goto', url });
            }),
            click: vi.fn(async (selector) => {
                calls.push({ type: 'click', selector });
            })
        };
    }

    afterEach(() => {
        delete global.document;
    });

    it('detects the largest sibling button group outside nav/header and returns one variant per label', async () => {
        const panelParent = {};
        const buttons = [
            fakeButton({ text: 'sGRC Platform', parent: panelParent }),
            fakeButton({ text: 'ISO 27001', parent: panelParent }),
            fakeButton({ text: 'KVKK Uyum', parent: panelParent }),
            fakeButton({ text: 'Menü', parent: {}, inNav: true }) // excluded: inside nav
        ];
        const page = makeFakePage(buttons);

        const variants = await discoverTabVariants(page, 'https://example.test/solutions');

        expect(variants.map((v) => v.label).sort()).toEqual(['ISO 27001', 'KVKK Uyum', 'sGRC Platform'].sort());
        expect(variants.every((v) => v.rawText === 'panel content')).toBe(true);
    });

    it('never clicks a candidate matching NAV_DISCOVERY_ACTION_WORDS', async () => {
        const panelParent = {};
        const buttons = [
            fakeButton({ text: 'ISO 27001', parent: panelParent }),
            fakeButton({ text: 'Demo Talep Et', parent: panelParent })
        ];
        const page = makeFakePage(buttons);

        const variants = await discoverTabVariants(page, 'https://example.test/solutions');

        expect(variants.map((v) => v.label)).toEqual(['ISO 27001']);
        expect(page.click).not.toHaveBeenCalledWith('text=Demo Talep Et', expect.anything());
    });

    it('does a fresh page reload before each candidate click (goto, click, goto, click, ...)', async () => {
        const panelParent = {};
        const buttons = [
            fakeButton({ text: 'sGRC Platform', parent: panelParent }),
            fakeButton({ text: 'ISO 27001', parent: panelParent })
        ];
        const page = makeFakePage(buttons);

        await discoverTabVariants(page, 'https://example.test/solutions');

        // The leading goto is a defensive reload before group detection
        // itself (see discoverTabVariants' docstring — a real site's DOM
        // arrived here corrupted by a prior goBack()-based restore).
        expect(page.calls.map((c) => c.type)).toEqual(['goto', 'goto', 'click', 'goto', 'click']);
        expect(page.calls.filter((c) => c.type === 'goto').every((c) => c.url === 'https://example.test/solutions')).toBe(
            true
        );
    });

    it('caps candidates at MAX_TAB_DISCOVERY_CLICKS', async () => {
        const panelParent = {};
        const buttons = Array.from({ length: 10 }, (_, i) => fakeButton({ text: `Sekme ${i}`, parent: panelParent }));
        const page = makeFakePage(buttons);

        const variants = await discoverTabVariants(page, 'https://example.test/solutions');

        expect(variants.length).toBe(8); // default MAX_TAB_DISCOVERY_CLICKS
    });

    it('returns no variants when fewer than 2 candidates share a parent (not a real tab group)', async () => {
        const buttons = [fakeButton({ text: 'Tek Buton', parent: {} })];
        const page = makeFakePage(buttons);

        const variants = await discoverTabVariants(page, 'https://example.test/solutions');

        // The leading defensive reload (see above) still happens — it's
        // unconditional, before we know whether a real group exists — but
        // no per-candidate click follows since there's nothing to click.
        expect(variants).toEqual([]);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.click).not.toHaveBeenCalled();
    });
});

describe('discoverToggleVariants', () => {
    it('captures and restores a collapsed content toggle with stable identity metadata', async () => {
        const locator = {
            first: vi.fn(function () { return this; }),
            waitFor: vi.fn(async () => {}),
            click: vi.fn(async () => {}),
            evaluate: vi.fn(async () => ({
                expanded: true,
                revealedText: 'Midas uygulamasında Yatırım Hesabı bölümünü açın.'
            }))
        };
        const page = {
            evaluate: vi.fn(async (fn) => fn.toString().includes("querySelectorAll('[aria-expanded]')")
                ? [{
                      index: 0,
                      label: 'Midas ekstresini nasıl yüklerim?',
                      controlsId: 'faq-midas',
                      sectionLabel: 'Sıkça Sorulan Sorular',
                      initialExpanded: false
                  }]
                : 100),
            locator: vi.fn(() => locator),
            waitForTimeout: vi.fn(async () => {})
        };

        const result = await discoverToggleVariants(page, 'https://example.com/faq');

        expect(locator.click).toHaveBeenCalledTimes(2); // open, then restore
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            elementPath: 'sikca-sorulan-sorular/midas-ekstresini-nasil-yuklerim',
            label: 'Midas ekstresini nasıl yüklerim?',
            selector: '[aria-controls="faq-midas"]',
            expanded: true,
            revealedText: 'Midas uygulamasında Yatırım Hesabı bölümünü açın.'
        });
        expect(result[0].elementKey).toMatch(/^el_[a-f0-9]{16}$/);
    });

    it('ignores action-like expanded controls instead of clicking arbitrary CTAs', async () => {
        const page = {
            evaluate: vi.fn(async () => [{
                index: 0,
                label: 'Demo talep et',
                controlsId: 'demo',
                sectionLabel: null,
                initialExpanded: false
            }]),
            locator: vi.fn()
        };

        await expect(discoverToggleVariants(page, 'https://example.com')).resolves.toEqual([]);
        expect(page.locator).not.toHaveBeenCalled();
    });
});
