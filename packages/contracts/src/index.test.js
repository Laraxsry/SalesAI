import { describe, it, expect } from 'vitest';
import {
    ProductInput,
    EmbedConfigInput,
    EmbedSessionInput,
    isValidEmbedDomainPattern,
    matchesEmbedDomain
} from './index.js';

/**
 * ProductInput is the API boundary for POST /products. Its URL fields feed the
 * guided tour's SSRF trust root, so these tests pin down that unsafe schemes
 * and private/reserved IPs can never enter as websiteUrl/tourAllowedDomains.
 */
describe('ProductInput.websiteUrl', () => {
    it('accepts a normal public https URL', () => {
        const result = ProductInput.safeParse({ name: 'SalesAI', websiteUrl: 'https://salesai.example' });
        expect(result.success).toBe(true);
    });

    it('accepts a public http URL with a path', () => {
        const result = ProductInput.safeParse({ name: 'SalesAI', websiteUrl: 'http://salesai.example/pricing' });
        expect(result.success).toBe(true);
    });

    it('is optional (omitting it is valid)', () => {
        const result = ProductInput.safeParse({ name: 'SalesAI' });
        expect(result.success).toBe(true);
    });

    it.each([
        ['file scheme', 'file:///etc/passwd'],
        ['ftp scheme', 'ftp://internal/secret.txt'],
        ['cloud metadata IP', 'http://169.254.169.254/latest/meta-data/'],
        ['loopback IPv4', 'http://127.0.0.1:6379'],
        ['localhost hostname', 'http://localhost:3000'],
        ['private 10.x', 'http://10.0.0.5'],
        ['private 192.168.x', 'http://192.168.1.5'],
        ['private 172.16.x', 'http://172.16.0.1'],
        ['loopback IPv6', 'http://[::1]:8080']
    ])('rejects %s', (_label, url) => {
        const result = ProductInput.safeParse({ name: 'SalesAI', websiteUrl: url });
        expect(result.success).toBe(false);
    });
});

describe('ProductInput.tourAllowedDomains', () => {
    it('defaults to an empty array when omitted', () => {
        const result = ProductInput.safeParse({ name: 'SalesAI' });
        expect(result.success).toBe(true);
        expect(result.data.tourAllowedDomains).toEqual([]);
    });

    it('accepts a list of public URLs', () => {
        const result = ProductInput.safeParse({
            name: 'SalesAI',
            tourAllowedDomains: ['https://salesai.example', 'https://docs.salesai.example']
        });
        expect(result.success).toBe(true);
    });

    it('rejects the whole list if any entry is a private/reserved address', () => {
        const result = ProductInput.safeParse({
            name: 'SalesAI',
            tourAllowedDomains: ['https://salesai.example', 'http://169.254.169.254/']
        });
        expect(result.success).toBe(false);
    });
});

/**
 * The embed domain pattern + matcher pair is the widget's origin trust
 * boundary (Phase 5): patterns are validated here at the API edge and matched
 * at request time by the embed origin middleware. Both halves live in this
 * package precisely so these tests can pin them together — a lookalike domain
 * slipping past the wildcard would silently open the widget to any site.
 */
describe('isValidEmbedDomainPattern', () => {
    it.each([
        ['bare domain', 'salesai.example'],
        ['subdomain', 'app.salesai.example'],
        ['wildcard', '*.salesai.example'],
        ['single label (dev localhost)', 'localhost'],
        ['hyphenated label', 'my-app.salesai.example']
    ])('accepts %s', (_label, pattern) => {
        expect(isValidEmbedDomainPattern(pattern)).toBe(true);
    });

    it.each([
        ['empty string', ''],
        ['bare wildcard', '*.'],
        ['wildcard without dot', '*salesai.example'],
        ['inner wildcard', 'app.*.salesai.example'],
        ['scheme included', 'https://salesai.example'],
        ['port included', 'salesai.example:5173'],
        ['path included', 'salesai.example/widget'],
        ['IPv4 literal', '192.168.1.5'],
        ['IPv6 literal', '::1'],
        ['leading hyphen label', '-bad.salesai.example'],
        ['empty label (double dot)', 'app..salesai.example']
    ])('rejects %s', (_label, pattern) => {
        expect(isValidEmbedDomainPattern(pattern)).toBe(false);
    });
});

describe('matchesEmbedDomain', () => {
    it('matches an exact pattern only against itself', () => {
        expect(matchesEmbedDomain('salesai.example', 'salesai.example')).toBe(true);
        expect(matchesEmbedDomain('app.salesai.example', 'salesai.example')).toBe(false);
        expect(matchesEmbedDomain('salesai.example.attacker.example', 'salesai.example')).toBe(false);
    });

    it('matches wildcard patterns against subdomains at any depth', () => {
        expect(matchesEmbedDomain('app.salesai.example', '*.salesai.example')).toBe(true);
        expect(matchesEmbedDomain('deep.app.salesai.example', '*.salesai.example')).toBe(true);
    });

    it('wildcard does NOT match the apex domain itself', () => {
        expect(matchesEmbedDomain('salesai.example', '*.salesai.example')).toBe(false);
    });

    it('wildcard does NOT match lookalike suffixes without a label boundary', () => {
        expect(matchesEmbedDomain('evilsalesai.example', '*.salesai.example')).toBe(false);
        expect(matchesEmbedDomain('untrusted.example', '*.salesai.example')).toBe(false);
    });

    it('is case-insensitive on the hostname side', () => {
        expect(matchesEmbedDomain('App.SalesAI.example', '*.salesai.example')).toBe(true);
    });

    it('rejects anything when the pattern itself is invalid', () => {
        expect(matchesEmbedDomain('salesai.example', 'https://salesai.example')).toBe(false);
        expect(matchesEmbedDomain('salesai.example', '')).toBe(false);
    });
});

describe('EmbedConfigInput', () => {
    it('applies documented defaults on an empty body', () => {
        const result = EmbedConfigInput.safeParse({});
        expect(result.success).toBe(true);
        expect(result.data.theme).toEqual({ primaryColor: '#4f46e5', mode: 'auto' });
        expect(result.data.launcher).toEqual({ position: 'bottom-right', label: 'Talk to sales' });
        expect(result.data.micAutoPrompt).toBe(false);
        expect(result.data.rateCaps).toEqual({ sessionsPerIpPerHour: 6, sessionsPerOriginPerHour: 60 });
        expect(result.data.domains).toEqual([]);
    });

    it('accepts a full valid config and lowercases domains', () => {
        const result = EmbedConfigInput.safeParse({
            theme: { primaryColor: '#FF8800', mode: 'dark' },
            launcher: { position: 'bottom-left', label: 'Chat with us' },
            greeting: 'Hi! Ask me anything.',
            micAutoPrompt: true,
            rateCaps: { sessionsPerIpPerHour: 10, sessionsPerOriginPerHour: 120 },
            domains: ['SalesAI.example', '*.salesai.example']
        });
        expect(result.success).toBe(true);
        expect(result.data.domains).toEqual(['salesai.example', '*.salesai.example']);
    });

    it('rejects an invalid domain pattern in the list', () => {
        const result = EmbedConfigInput.safeParse({ domains: ['https://salesai.example'] });
        expect(result.success).toBe(false);
    });

    it('rejects a non-hex theme color', () => {
        const result = EmbedConfigInput.safeParse({ theme: { primaryColor: 'red' } });
        expect(result.success).toBe(false);
    });
});

describe('EmbedSessionInput', () => {
    it('accepts an empty body (both fields optional)', () => {
        const result = EmbedSessionInput.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts a visitorName and a valid pageUrl', () => {
        const result = EmbedSessionInput.safeParse({
            visitorName: 'Jordan',
            pageUrl: 'https://salesai.example/pricing'
        });
        expect(result.success).toBe(true);
    });

    it('rejects a non-URL pageUrl', () => {
        const result = EmbedSessionInput.safeParse({ pageUrl: 'not-a-url' });
        expect(result.success).toBe(false);
    });
});
