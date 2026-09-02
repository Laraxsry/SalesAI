import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@repo/rag', () => ({ retrieve: vi.fn() }));

const { retrieve } = await import('@repo/rag');
const { buildTools } = await import('./tools.js');

function toolNames(tools) {
    return tools.map((t) => t.name);
}

function findTool(tools, name) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool not found: ${name}`);
    return tool;
}

describe('buildTools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const BASE_TOOL_NAMES = [
        'search_knowledge',
        'start_guided_tour',
        'navigate_to',
        'find_page',
        'find_element',
        'highlight',
        'click_element',
        'scroll_page',
        'read_customer_screen',
        'stop_screen_share',
        'read_tour_screen',
        'save_contact_info',
        'expect_response',
        'flag_followup_needed'
    ];

    it('exposes exactly the expected tool set (no advance_step) when no playbook is active, each with a name/description/parameters/handler', () => {
        const tools = buildTools({ productId: 'p1' });

        expect(toolNames(tools)).toEqual(BASE_TOOL_NAMES);
        for (const tool of tools) {
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.parameters).toMatchObject({ type: 'object' });
            expect(typeof tool.handler).toBe('function');
        }
    });

    // Regression test — a real session log showed the model calling
    // advance_step in free-form conversation (no playbook), purely off the
    // tool's own description, then treating the no-op {ok:true} result as
    // permission to go quiet and wait for the visitor. The tool must not be
    // offered to the model at all outside playbook mode — see buildTools'
    // docstring.
    it('only includes advance_step when playbookActive is true', () => {
        const withoutPlaybook = buildTools({ productId: 'p1' });
        const withPlaybook = buildTools({ productId: 'p1', playbookActive: true });

        expect(toolNames(withoutPlaybook)).not.toContain('advance_step');
        expect(toolNames(withPlaybook)).toEqual([...BASE_TOOL_NAMES, 'advance_step']);
    });

    it('only includes next_participant when multiParticipant is true', () => {
        const solo = buildTools({ productId: 'p1' });
        const group = buildTools({ productId: 'p1', multiParticipant: true });

        expect(toolNames(solo)).not.toContain('next_participant');
        expect(toolNames(group)).toEqual([...BASE_TOOL_NAMES, 'next_participant']);
    });

    it('composes follow-up, group-floor and playbook tools without dropping any capability', () => {
        const tools = buildTools({
            productId: 'p1',
            multiParticipant: true,
            playbookActive: true
        });

        expect(toolNames(tools)).toEqual([
            ...BASE_TOOL_NAMES,
            'next_participant',
            'advance_step'
        ]);
        expect(toolNames(tools)).toContain('flag_followup_needed');
    });

    describe('search_knowledge', () => {
        it('retrieves for the bound productId and maps chunks to {text, score, sourceId}', async () => {
            retrieve.mockResolvedValue([
                { text: 'a', score: 0.9, sourceId: 's1', irrelevant: 'dropped' },
                { text: 'b', score: 0.5, sourceId: 's2' }
            ]);
            const tools = buildTools({ productId: 'prod-123' });

            const result = await findTool(tools, 'search_knowledge').handler({ query: 'pricing' });

            expect(retrieve).toHaveBeenCalledWith({ productId: 'prod-123', query: 'pricing', topK: 8 });
            expect(result).toEqual([
                { text: 'a', score: 0.9, sourceId: 's1' },
                { text: 'b', score: 0.5, sourceId: 's2' }
            ]);
        });

        it('forwards an explicit topK instead of the default', async () => {
            retrieve.mockResolvedValue([]);
            const tools = buildTools({ productId: 'prod-123' });

            await findTool(tools, 'search_knowledge').handler({ query: 'pricing', topK: 3 });

            expect(retrieve).toHaveBeenCalledWith({ productId: 'prod-123', query: 'pricing', topK: 3 });
        });

        // A real DB test found nav-link labels are often unrelated to a
        // page's actual content, which breaks find_page for exactly the
        // queries a visitor asks. metadata.pageUrl is the RAG match itself
        // telling us the real source page — must survive to the tool result.
        it('includes pageUrl when a chunk has metadata.pageUrl', async () => {
            retrieve.mockResolvedValue([
                { text: 'a', score: 0.9, sourceId: 's1', metadata: { pageUrl: 'https://example.com/iso' } },
                { text: 'b', score: 0.5, sourceId: 's2', metadata: { chunkIndex: 2 } },
                { text: 'c', score: 0.4, sourceId: 's3' }
            ]);
            const tools = buildTools({ productId: 'prod-123' });

            const result = await findTool(tools, 'search_knowledge').handler({ query: 'iso' });

            expect(result).toEqual([
                { text: 'a', score: 0.9, sourceId: 's1', pageUrl: 'https://example.com/iso' },
                { text: 'b', score: 0.5, sourceId: 's2' },
                { text: 'c', score: 0.4, sourceId: 's3' }
            ]);
        });

        // A rotating "solutions" page only shows one panel by default —
        // read_tour_screen can correctly report a fact isn't visible even
        // though search_knowledge just found it on that exact pageUrl,
        // because it's behind a different tab. tabLabel is what lets the
        // model know to click that tab first (see discoverTabVariants).
        it('includes tabLabel when a chunk has metadata.tabLabel, omits it otherwise', async () => {
            retrieve.mockResolvedValue([
                {
                    text: 'a',
                    score: 0.9,
                    sourceId: 's1',
                    metadata: { pageUrl: 'https://example.com/solutions', tabLabel: 'ISO 22301' }
                },
                { text: 'b', score: 0.5, sourceId: 's2', metadata: { pageUrl: 'https://example.com/about' } }
            ]);
            const tools = buildTools({ productId: 'prod-123' });

            const result = await findTool(tools, 'search_knowledge').handler({ query: 'iso 22301' });

            expect(result).toEqual([
                {
                    text: 'a',
                    score: 0.9,
                    sourceId: 's1',
                    pageUrl: 'https://example.com/solutions',
                    tabLabel: 'ISO 22301'
                },
                { text: 'b', score: 0.5, sourceId: 's2', pageUrl: 'https://example.com/about' }
            ]);
        });
    });

    describe('find_page', () => {
        const siteMap = [
            {
                url: 'https://example.test/',
                parentUrl: null,
                links: [
                    { label: 'İletişim', targetUrl: 'https://example.test/contact', kind: 'link' },
                    { label: 'Fiyatlandırma', targetUrl: 'https://example.test/pricing', kind: 'button' }
                ]
            },
            { url: 'https://example.test/contact', parentUrl: 'https://example.test/', links: [] }
        ];

        it('matches a page/button by (case-insensitive) label substring', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_page').handler({ query: 'iletişim' });

            expect(result).toEqual({
                candidates: [
                    {
                        url: 'https://example.test/contact',
                        label: 'İletişim',
                        kind: 'link',
                        foundOnPage: 'https://example.test/'
                    }
                ]
            });
        });

        it('also matches directly on a page URL', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_page').handler({ query: 'contact' });

            expect(result.candidates.map((c) => c.url)).toContain('https://example.test/contact');
        });

        it('returns no candidates when siteMap is empty/unset', async () => {
            const tools = buildTools({ productId: 'p1' });

            const result = await findTool(tools, 'find_page').handler({ query: 'anything' });

            expect(result).toEqual({ candidates: [] });
        });

        // Regression test — a real live session's find_page calls came back
        // {"candidates":[]} for BOTH queries the model actually sent, because
        // the old implementation checked `label.includes(fullQuery)`: no
        // crawled label is ever long enough to literally contain a whole
        // natural-language sentence. Word-overlap matching (in either
        // direction, tolerant of Turkish suffixes) is what actually finds
        // real candidates for how the model phrases queries in practice.
        it('matches a real multi-word natural-language query the model actually sends (not a short label)', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_page').handler({
                query: 'Cyberverse iletişim veya bize ulaşın sayfası'
            });

            expect(result.candidates.map((c) => c.url)).toContain('https://example.test/contact');
        });

        it('matches across a Turkish suffix (site label vs. a differently-inflected query word)', async () => {
            const suffixedSiteMap = [
                {
                    url: 'https://example.test/',
                    parentUrl: null,
                    links: [{ label: 'Çözümlerimiz', targetUrl: 'https://example.test/solutions', kind: 'button' }]
                }
            ];
            const tools = buildTools({ productId: 'p1', siteMap: suffixedSiteMap });

            const result = await findTool(tools, 'find_page').handler({ query: 'çözümler sayfası' });

            expect(result.candidates.map((c) => c.url)).toContain('https://example.test/solutions');
        });
    });

    describe('find_element', () => {
        const siteMap = [
            {
                url: 'https://example.test/pricing',
                components: {
                    interactiveElements: [
                        { label: 'Planı Seç', kind: 'button', selector: 'text=Planı Seç' },
                        { label: 'Gönder', kind: 'submit', selector: 'text=Gönder' }
                    ],
                    sections: [{ tag: 'section', ariaLabel: 'Fiyatlandırma bölümü', textSnippet: '...' }]
                }
            },
            {
                url: 'https://example.test/contact',
                components: { interactiveElements: [], sections: [{ tag: 'form', ariaLabel: null, textSnippet: 'İletişim formu...' }] }
            }
        ];

        it('matches an interactive element by (case-insensitive) label substring, returning its ready-made selector', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_element').handler({ query: 'planı seç' });

            expect(result).toEqual({
                candidates: [
                    { pageUrl: 'https://example.test/pricing', selector: 'text=Planı Seç', kind: 'button', label: 'Planı Seç' }
                ]
            });
        });

        it('matches a section by aria-label, using an attribute selector', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_element').handler({ query: 'fiyatlandırma' });

            expect(result.candidates).toContainEqual({
                pageUrl: 'https://example.test/pricing',
                selector: '[aria-label="Fiyatlandırma bölümü"]',
                kind: 'section',
                label: 'Fiyatlandırma bölümü'
            });
        });

        it('matches a real multi-word natural-language query the model actually sends (not a short label)', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_element').handler({
                query: 'ürünü satın almak veya planı seçmek için buton'
            });

            expect(result.candidates.map((c) => c.selector)).toContain('text=Planı Seç');
        });

        it('ignores a section with no aria-label (no reliable selector to offer)', async () => {
            const tools = buildTools({ productId: 'p1', siteMap });

            const result = await findTool(tools, 'find_element').handler({ query: 'iletişim formu' });

            expect(result).toEqual({ candidates: [] });
        });

        it('returns no candidates when siteMap is empty/unset', async () => {
            const tools = buildTools({ productId: 'p1' });

            const result = await findTool(tools, 'find_element').handler({ query: 'anything' });

            expect(result).toEqual({ candidates: [] });
        });

        it('returns no candidates for a page with no components (legacy crawl)', async () => {
            const tools = buildTools({ productId: 'p1', siteMap: [{ url: 'https://example.test/old' }] });

            const result = await findTool(tools, 'find_element').handler({ query: 'anything' });

            expect(result).toEqual({ candidates: [] });
        });

        // Real crawl data showed a badge with the identical selector repeated
        // on every page, alone filling the whole candidate cap and crowding
        // out page-specific matches.
        it('dedups the same selector across pages, keeping only the first occurrence', async () => {
            const repeatedSiteMap = [
                {
                    url: 'https://example.test/a',
                    components: {
                        interactiveElements: [{ label: 'ISO 27001', kind: 'badge', selector: 'text=ISO 27001' }]
                    }
                },
                {
                    url: 'https://example.test/b',
                    components: {
                        interactiveElements: [{ label: 'ISO 27001', kind: 'badge', selector: 'text=ISO 27001' }]
                    }
                },
                {
                    url: 'https://example.test/c',
                    components: {
                        interactiveElements: [{ label: 'ISO 27001', kind: 'badge', selector: 'text=ISO 27001' }]
                    }
                }
            ];
            const tools = buildTools({ productId: 'p1', siteMap: repeatedSiteMap });

            const result = await findTool(tools, 'find_element').handler({ query: 'ISO 27001' });

            expect(result.candidates).toEqual([
                { pageUrl: 'https://example.test/a', selector: 'text=ISO 27001', kind: 'badge', label: 'ISO 27001' }
            ]);
        });
    });

    describe('tour-backed tools', () => {
        const cases = [
            ['start_guided_tour', 'openAt', { url: 'https://example.test' }, ['https://example.test']],
            ['navigate_to', 'goto', { url: '/pricing' }, ['/pricing']],
            ['highlight', 'highlight', { selector: 'text=Ücretler' }, ['text=Ücretler']],
            ['click_element', 'click', { selector: 'text=Kaydet' }, ['text=Kaydet']],
            ['scroll_page', 'scroll', { direction: 'down', amount: 2, target: 'pricing' }, ['down', 2, 'pricing']],
            ['read_tour_screen', 'readScreen', { question: 'what does the chart show?' }, ['what does the chart show?']]
        ];

        it.each(cases)('%s calls tour.%s with the tool args and returns its result', async (toolName, method, args, expectedCallArgs) => {
            const tour = { [method]: vi.fn().mockResolvedValue({ ok: true, marker: toolName }) };
            const tools = buildTools({ productId: 'p1', tour });

            const result = await findTool(tools, toolName).handler(args);

            expect(tour[method]).toHaveBeenCalledWith(...expectedCallArgs);
            expect(result).toEqual({ ok: true, marker: toolName });
        });

        it.each(cases)('%s falls back to { ok: false } when tour is missing', async (toolName, _method, args) => {
            const tools = buildTools({ productId: 'p1' });
            const result = await findTool(tools, toolName).handler(args);
            expect(result).toEqual({ ok: false });
        });

        it.each(cases)('%s falls back to { ok: false } when tour.%s is not implemented', async (toolName, method, args) => {
            const tools = buildTools({ productId: 'p1', tour: {} });
            const result = await findTool(tools, toolName).handler(args);
            expect(result).toEqual({ ok: false });
        });
    });

    describe('read_customer_screen', () => {
        it('calls screen.read with the question and returns its result', async () => {
            const screen = { read: vi.fn().mockResolvedValue({ ok: true, analysis: 'a chart' }) };
            const tools = buildTools({ productId: 'p1', screen });

            const result = await findTool(tools, 'read_customer_screen').handler({ question: 'what is shown?' });

            expect(screen.read).toHaveBeenCalledWith('what is shown?');
            expect(result).toEqual({ ok: true, analysis: 'a chart' });
        });

        it('falls back to { ok: false } when screen is missing', async () => {
            const tools = buildTools({ productId: 'p1' });
            const result = await findTool(tools, 'read_customer_screen').handler({ question: 'x' });
            expect(result).toEqual({ ok: false });
        });
    });

    describe('stop_screen_share', () => {
        it('calls the bound stopScreenShare and returns its result', async () => {
            const stopScreenShare = vi.fn().mockResolvedValue({ ok: true, tour: 'stopped' });
            const tools = buildTools({ productId: 'p1', stopScreenShare });

            const result = await findTool(tools, 'stop_screen_share').handler({});

            expect(stopScreenShare).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ ok: true, tour: 'stopped' });
        });

        it('falls back to { ok: false } when stopScreenShare is missing', async () => {
            const tools = buildTools({ productId: 'p1' });
            const result = await findTool(tools, 'stop_screen_share').handler({});
            expect(result).toEqual({ ok: false });
        });
    });

    describe('expect_response', () => {
        it('calls the bound expectResponse and returns its result', async () => {
            const expectResponse = vi.fn().mockResolvedValue({ ok: true });
            const tools = buildTools({ productId: 'p1', expectResponse });

            const result = await findTool(tools, 'expect_response').handler({});

            expect(expectResponse).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ ok: true });
        });

        it('falls back to { ok: false } when expectResponse is not wired', async () => {
            const tools = buildTools({ productId: 'p1' });
            const result = await findTool(tools, 'expect_response').handler({});
            expect(result).toEqual({ ok: false });
        });

        it('is available regardless of playbookActive (contact confirmation can happen in either mode)', () => {
            const withoutPlaybook = buildTools({ productId: 'p1' });
            const withPlaybook = buildTools({ productId: 'p1', playbookActive: true });
            expect(toolNames(withoutPlaybook)).toContain('expect_response');
            expect(toolNames(withPlaybook)).toContain('expect_response');
        });
    });

    describe('flag_followup_needed', () => {
        it('calls the bound flagFollowup with the question and returns its result', async () => {
            const flagFollowup = vi.fn().mockResolvedValue({ ok: true });
            const tools = buildTools({ productId: 'p1', flagFollowup });

            const result = await findTool(tools, 'flag_followup_needed').handler({ question: 'Ürün X ile entegre olur mu?' });

            expect(flagFollowup).toHaveBeenCalledWith('Ürün X ile entegre olur mu?');
            expect(result).toEqual({ ok: true });
        });

        it('falls back to { ok: false } when flagFollowup is missing', async () => {
            const tools = buildTools({ productId: 'p1' });
            const result = await findTool(tools, 'flag_followup_needed').handler({ question: 'x' });
            expect(result).toEqual({ ok: false });
        });
    });

    describe('advance_step', () => {
        it('calls the bound advanceStep and returns its result', async () => {
            const advanceStep = vi.fn().mockResolvedValue({ ok: true });
            const tools = buildTools({ productId: 'p1', playbookActive: true, advanceStep });

            const result = await findTool(tools, 'advance_step').handler({});

            expect(advanceStep).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ ok: true });
        });

        it('falls back to { ok: false } when advanceStep is missing even though playbookActive is true', async () => {
            const tools = buildTools({ productId: 'p1', playbookActive: true });
            const result = await findTool(tools, 'advance_step').handler({});
            expect(result).toEqual({ ok: false });
        });
    });
});
