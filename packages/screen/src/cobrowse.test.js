import { describe, it, expect } from 'vitest';
import { trustKey, assertHttpUrl } from './cobrowse.js';

/**
 * trustKey/assertHttpUrl are the pure core of the guided tour's SSRF guard.
 * These tests lock in their behaviour so a future refactor can't silently
 * loosen the trust boundary (which is exactly how it got regressed once).
 */
describe('trustKey', () => {
    it('collapses subdomains of the same product to one key (eTLD+1)', () => {
        expect(trustKey('https://app.example.com')).toBe(trustKey('https://admin.example.com'));
        expect(trustKey('https://www.example.com/pricing')).toBe('example.com');
    });

    it('treats different registrable domains as different keys', () => {
        expect(trustKey('https://salesai.example')).not.toBe(trustKey('https://untrusted.example'));
    });

    it('keeps different ports on a bare host separate (full-origin fallback)', () => {
        // No public suffix -> falls back to protocol+host+port, so a trusted
        // localhost:5432 must NOT also trust localhost:6379.
        expect(trustKey('http://localhost:5432')).not.toBe(trustKey('http://localhost:6379'));
        expect(trustKey('http://127.0.0.1:5432')).not.toBe(trustKey('http://127.0.0.1:6379'));
    });

    it('returns null for an unparseable URL', () => {
        expect(trustKey('not a url')).toBeNull();
        expect(trustKey('')).toBeNull();
    });
});

describe('assertHttpUrl', () => {
    it('accepts http and https', () => {
        expect(() => assertHttpUrl('http://salesai.example')).not.toThrow();
        expect(() => assertHttpUrl('https://salesai.example')).not.toThrow();
    });

    it('rejects non-http(s) schemes', () => {
        expect(() => assertHttpUrl('file:///etc/passwd')).toThrow(/Unsupported URL scheme/);
        expect(() => assertHttpUrl('ftp://host/x')).toThrow(/Unsupported URL scheme/);
    });

    it('rejects a string that is not a URL at all', () => {
        expect(() => assertHttpUrl('not a url')).toThrow(/Invalid URL/);
    });
});
