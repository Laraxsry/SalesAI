import { describe, it, expect } from 'vitest';
import { readClaimedOrigin, isLocalhostAllowedInDev } from './embed-origin.js';

/**
 * readClaimedOrigin/isLocalhostAllowedInDev feed directly into the embed
 * widget's origin-allowlist check (enforceEmbedOrigin). Both are pure and
 * cheap to pin down, but a subtle regression in either would silently widen
 * who can call the embed session endpoint — the same reasoning that makes
 * the SSRF-guard tests in @repo/contracts worth having.
 */
describe('readClaimedOrigin', () => {
    it('reads the Origin header when present', () => {
        const req = { headers: { origin: 'https://salesai.example' } };
        expect(readClaimedOrigin(req)).toEqual({
            href: 'https://salesai.example',
            hostname: 'salesai.example'
        });
    });

    it('falls back to Referer when Origin is absent', () => {
        const req = { headers: { referer: 'https://salesai.example/pricing?ref=ad' } };
        expect(readClaimedOrigin(req)).toEqual({
            href: 'https://salesai.example',
            hostname: 'salesai.example'
        });
    });

    it('prefers Origin over Referer when both are present', () => {
        const req = {
            headers: {
                origin: 'https://salesai.example',
                referer: 'https://untrusted.example/'
            }
        };
        expect(readClaimedOrigin(req).hostname).toBe('salesai.example');
    });

    it('lowercases the hostname', () => {
        const req = { headers: { origin: 'https://App.SalesAI.example' } };
        expect(readClaimedOrigin(req).hostname).toBe('app.salesai.example');
    });

    it('returns null when neither header is present', () => {
        expect(readClaimedOrigin({ headers: {} })).toBeNull();
    });

    it('returns null for an unparseable header value', () => {
        const req = { headers: { origin: 'not a url' } };
        expect(readClaimedOrigin(req)).toBeNull();
    });
});

describe('isLocalhostAllowedInDev', () => {
    it('allows localhost outside production', () => {
        expect(isLocalhostAllowedInDev('localhost', 'development')).toBe(true);
        expect(isLocalhostAllowedInDev('localhost', undefined)).toBe(true);
    });

    it('rejects localhost in production', () => {
        expect(isLocalhostAllowedInDev('localhost', 'production')).toBe(false);
    });

    it('rejects any non-localhost hostname regardless of environment', () => {
        expect(isLocalhostAllowedInDev('salesai.example', 'development')).toBe(false);
        expect(isLocalhostAllowedInDev('127.0.0.1', 'development')).toBe(false);
    });
});
