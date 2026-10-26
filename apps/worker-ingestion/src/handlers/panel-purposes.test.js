import { describe, expect, it, vi } from 'vitest';
import { addElementPurposes } from './panel-purposes.js';

const element = (label, extra = {}) => ({ label, kind: 'button', selector: `#${label}`, elementKey: `el_${label}`, ...extra });
const page = (...elements) => ({ components: { interactiveElements: elements } });

describe('addElementPurposes', () => {
    it('describes only buttons whose press was observed, with what was observed', async () => {
        const describeMock = vi.fn(async () => ({ 'New variable': 'Adds a variable.' }));
        const pagesIndex = {
            'https://app.example/vars': page(element('New variable', { expected: 'Opens a panel with a form.' }), element('Search')),
            'https://app.example/empty': page(element('Plain'))
        };

        const result = await addElementPurposes({ pagesIndex, describe: describeMock, language: 'Turkish' });

        expect(describeMock).toHaveBeenCalledTimes(1);
        expect(describeMock).toHaveBeenCalledWith({
            pageUrl: 'https://app.example/vars',
            items: [{ label: 'New variable', observed: 'Opens a panel with a form.' }],
            language: 'Turkish'
        });
        expect(pagesIndex['https://app.example/vars'].components.interactiveElements[0].purpose).toBe('Adds a variable.');
        expect(result).toEqual({ pages: 1, described: 1 });
    });

    it('leaves the key and selector of every button as they were', async () => {
        const pagesIndex = { u: page(element('A', { expected: 'Opens a menu.' })) };

        await addElementPurposes({ pagesIndex, describe: async () => ({ A: 'Does a thing.' }) });

        expect(pagesIndex.u.components.interactiveElements[0]).toMatchObject({ elementKey: 'el_A', selector: '#A', purpose: 'Does a thing.' });
    });

    it('skips a button that already has a purpose, so an unchanged panel costs nothing to re-crawl', async () => {
        const describeMock = vi.fn(async () => ({}));
        const pagesIndex = { u: page(element('A', { expected: 'Opens a menu.', purpose: 'Already written.' })) };

        const result = await addElementPurposes({ pagesIndex, describe: describeMock });

        expect(describeMock).not.toHaveBeenCalled();
        expect(result).toEqual({ pages: 0, described: 0 });
    });

    it('bounds the cost: a few buttons per page, a few pages per crawl', async () => {
        const describeMock = vi.fn(async () => ({}));
        const buttons = Array.from({ length: 30 }, (_, i) => element(`B${i}`, { expected: 'Opens a menu.' }));
        const pagesIndex = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`https://app.example/p${i}`, page(...buttons)]));

        await addElementPurposes({ pagesIndex, describe: describeMock, maxPages: 3, maxItems: 4 });

        expect(describeMock).toHaveBeenCalledTimes(3);
        expect(describeMock.mock.calls[0][0].items).toHaveLength(4);
    });

    it('keeps going when the description of one page fails', async () => {
        const describeMock = vi.fn()
            .mockRejectedValueOnce(new Error('rate limited'))
            .mockResolvedValueOnce({ B: 'Does b.' });
        const pagesIndex = { one: page(element('A', { expected: 'x' })), two: page(element('B', { expected: 'y' })) };

        const result = await addElementPurposes({ pagesIndex, describe: describeMock });

        expect(result).toEqual({ pages: 2, described: 1 });
        expect(pagesIndex.one.components.interactiveElements[0].purpose).toBeUndefined();
        expect(pagesIndex.two.components.interactiveElements[0].purpose).toBe('Does b.');
    });
});
