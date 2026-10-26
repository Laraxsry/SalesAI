import { beforeEach, describe, expect, it, vi } from 'vitest';

const complete = vi.fn();
vi.mock('./llm/index.js', () => ({ getLLM: () => ({ complete }) }));

const { describeProcedure, describeUiElements } = await import('./describe-ui.js');

beforeEach(() => vi.clearAllMocks());

describe('describeProcedure', () => {
    it('asks for what the flow is for, in the requested language, without the steps', async () => {
        complete.mockResolvedValue({ text: '  Variables keep values.  ' });

        const text = await describeProcedure({ procedureText: '1. Press "New variable".', language: 'Turkish' });

        expect(text).toBe('Variables keep values.');
        const request = complete.mock.calls[0][0];
        expect(request.system).toContain('Respond only in Turkish');
        expect(request.system).toMatch(/Do NOT list the steps/);
        expect(request.messages[0].content).toContain('Press "New variable"');
    });

    it('returns an empty string for empty input without calling the model', async () => {
        await expect(describeProcedure({ procedureText: '   ' })).resolves.toBe('');
        expect(complete).not.toHaveBeenCalled();
    });

    it('returns an empty string when the model call fails', async () => {
        complete.mockRejectedValue(new Error('boom'));

        await expect(describeProcedure({ procedureText: 'x' })).resolves.toBe('');
    });

    it('keeps the prompt bounded for a very long recipe', async () => {
        complete.mockResolvedValue({ text: 'ok' });

        await describeProcedure({ procedureText: 'a'.repeat(20_000) });

        expect(complete.mock.calls[0][0].messages[0].content.length).toBeLessThan(3100);
    });
});

describe('describeUiElements', () => {
    const items = [
        { label: 'New variable', observed: 'Opens a panel with a form asking for: Name (text).' },
        { label: 'Edit view', observed: 'Shows more on the page: Resolution rate.' }
    ];

    it('returns one purpose per button, keyed by its exact label, from a single call', async () => {
        complete.mockResolvedValue({
            text: '```json\n[{"label":"New variable","purpose":"Adds a variable."},{"label":"Edit view","purpose":"Chooses which charts show."}]\n```'
        });

        const purposes = await describeUiElements({ pageUrl: 'https://app.example/vars', items, language: 'Turkish' });

        expect(purposes).toEqual({ 'New variable': 'Adds a variable.', 'Edit view': 'Chooses which charts show.' });
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete.mock.calls[0][0].system).toContain('Write each purpose in Turkish');
        expect(complete.mock.calls[0][0].messages[0].content).toContain('- "New variable": Opens a panel');
    });

    it('ignores answers for buttons it was not asked about and empty purposes', async () => {
        complete.mockResolvedValue({ text: '[{"label":"Invented","purpose":"x"},{"label":"New variable","purpose":"  "}]' });

        await expect(describeUiElements({ pageUrl: 'u', items })).resolves.toEqual({});
    });

    it('returns {} when the model does not answer in JSON, fails, or there is nothing to describe', async () => {
        complete.mockResolvedValueOnce({ text: 'Sorry, I cannot.' });
        await expect(describeUiElements({ pageUrl: 'u', items })).resolves.toEqual({});

        complete.mockRejectedValueOnce(new Error('boom'));
        await expect(describeUiElements({ pageUrl: 'u', items })).resolves.toEqual({});

        complete.mockClear();
        await expect(describeUiElements({ pageUrl: 'u', items: [] })).resolves.toEqual({});
        await expect(describeUiElements({ pageUrl: 'u', items: [{ label: 'x', observed: '' }] })).resolves.toEqual({});
        expect(complete).not.toHaveBeenCalled();
    });

    it('asks about at most twenty buttons at a time', async () => {
        complete.mockResolvedValue({ text: '[]' });
        const many = Array.from({ length: 40 }, (_, i) => ({ label: `Button ${i}`, observed: 'Opens a menu.' }));

        await describeUiElements({ pageUrl: 'u', items: many });

        expect(complete.mock.calls[0][0].messages[0].content.split('\n- ').length - 1).toBe(20);
    });
});

