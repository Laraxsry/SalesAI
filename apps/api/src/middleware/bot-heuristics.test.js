import { describe, it, expect } from 'vitest';
import { isSuspiciousUserAgent } from './bot-heuristics.js';

describe('isSuspiciousUserAgent', () => {
    it('flags missing or blank User-Agent', () => {
        expect(isSuspiciousUserAgent(undefined)).toBe(true);
        expect(isSuspiciousUserAgent('')).toBe(true);
        expect(isSuspiciousUserAgent('   ')).toBe(true);
    });

    it('flags known script/HTTP-library clients', () => {
        expect(isSuspiciousUserAgent('curl/8.4.0')).toBe(true);
        expect(isSuspiciousUserAgent('python-requests/2.31.0')).toBe(true);
        expect(isSuspiciousUserAgent('PostmanRuntime/7.36.0')).toBe(true);
        expect(isSuspiciousUserAgent('axios/1.6.0')).toBe(true);
        expect(isSuspiciousUserAgent('Mozilla/5.0 (compatible; SomeBot/1.0)')).toBe(true);
    });

    it('allows ordinary browser User-Agent strings', () => {
        const chrome =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        const safari =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
        expect(isSuspiciousUserAgent(chrome)).toBe(false);
        expect(isSuspiciousUserAgent(safari)).toBe(false);
    });
});
