import { describe, it, expect } from 'vitest';
import { buildEmbedSnippet, chunk, compact } from './index.js';

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
