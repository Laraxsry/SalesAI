import { describe, it, expect } from 'vitest';
import { buildEmbedSnippet, chunk, compact, mapWithConcurrency } from './index.js';

describe('buildEmbedSnippet', () => {
    it('renders the exact two-line snippet sellers paste onto their site', () => {
        const snippet = buildEmbedSnippet({
            apiBaseUrl: 'https://api.salesai.example',
            shareToken: 's_x7k2m9',
            sdkVersion: '0.1.0'
        });
        expect(snippet).toBe(
            '<script src="https://api.salesai.example/sdk/salesai.js?v=0.1.0"></script>\n' +
            "<script>SalesAI.init({ shareToken: 's_x7k2m9' }).mount();</script>"
        );
    });

    it('changes the script URL when sdkVersion changes (cache-busting)', () => {
        const a = buildEmbedSnippet({ apiBaseUrl: 'https://api.salesai.example', shareToken: 's_1', sdkVersion: '0.1.0' });
        const b = buildEmbedSnippet({ apiBaseUrl: 'https://api.salesai.example', shareToken: 's_1', sdkVersion: '0.2.0' });
        expect(a).not.toBe(b);
    });
});

describe('chunk', () => {
    it('splits an array into fixed-size groups, keeping a partial final group', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('returns an empty array for empty input', () => {
        expect(chunk([], 3)).toEqual([]);
    });
});

describe('compact', () => {
    it('drops only null/undefined values, keeping falsy-but-defined ones', () => {
        expect(compact({ a: 1, b: null, c: undefined, d: 0, e: '', f: false })).toEqual({
            a: 1,
            d: 0,
            e: '',
            f: false
        });
    });
});

describe('mapWithConcurrency', () => {
    it('produces results in input order regardless of completion order', async () => {
        const delays = [30, 10, 20, 0, 15];
        const results = await mapWithConcurrency(delays, 2, async (ms, i) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            return i;
        });
        expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    it('never runs more than `limit` calls at once', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
        });
        expect(maxInFlight).toBeLessThanOrEqual(2);
    });

    it('resolves immediately for an empty array', async () => {
        const results = await mapWithConcurrency([], 3, async () => {
            throw new Error('should never be called');
        });
        expect(results).toEqual([]);
    });
});
