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

    it('exposes exactly the expected tool set, each with a name/description/parameters/handler', () => {
        const tools = buildTools({ productId: 'p1' });

        expect(toolNames(tools)).toEqual([
            'search_knowledge',
            'start_guided_tour',
            'navigate_to',
            'highlight',
            'click_element',
            'read_customer_screen',
            'stop_screen_share',
            'read_tour_screen'
        ]);
        for (const tool of tools) {
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.parameters).toMatchObject({ type: 'object' });
            expect(typeof tool.handler).toBe('function');
        }
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
    });

    describe('tour-backed tools', () => {
        const cases = [
            ['start_guided_tour', 'openAt', { url: 'https://example.test' }, ['https://example.test']],
            ['navigate_to', 'goto', { url: '/pricing' }, ['/pricing']],
            ['highlight', 'highlight', { selector: 'text=Ücretler' }, ['text=Ücretler']],
            ['click_element', 'click', { selector: 'text=Kaydet' }, ['text=Kaydet']],
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
});
