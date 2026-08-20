import { describe, it, expect } from 'vitest';
import {
    ProductInput,
    EmbedConfigInput,
    EmbedSessionInput,
    isValidEmbedDomainPattern,
    matchesEmbedDomain,
    PlaybookNodeInput,
    PlaybookInput,
    normalizePlaybook,
    isTourNavigableUrl
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

/**
 * PlaybookNodeInput / PlaybookInput are the API boundary for POST
 * /agents/:id/playbook — see md/backend/agent_flow.md. The `url` field feeds
 * the same guided-tour trust root as ProductInput.websiteUrl, so it carries
 * the identical SSRF-safety refinement.
 */
describe('PlaybookNodeInput', () => {
    const base = { id: 'n1', order: 1, directive: 'Şirketi kısaca tanıt' };

    it('accepts a minimal node and defaults url/attach to null, mode to situational', () => {
        const result = PlaybookNodeInput.safeParse(base);
        expect(result.success).toBe(true);
        expect(result.data.url).toBeNull();
        expect(result.data.attach).toBeNull();
        expect(result.data.mode).toBe('situational');
    });

    it('accepts a full node with url, attach, and an explicit mode', () => {
        const result = PlaybookNodeInput.safeParse({
            ...base,
            url: 'https://demo.salesai.example/reports',
            attach: 'Rapor Ekle butonu',
            mode: 'important'
        });
        expect(result.success).toBe(true);
        expect(result.data.mode).toBe('important');
    });

    it('rejects an empty directive', () => {
        const result = PlaybookNodeInput.safeParse({ ...base, directive: '' });
        expect(result.success).toBe(false);
    });

    it('rejects a directive that is only whitespace', () => {
        const result = PlaybookNodeInput.safeParse({ ...base, directive: '   ' });
        expect(result.success).toBe(false);
    });

    it('rejects an unsafe url (private IP), same guard as ProductInput.websiteUrl', () => {
        const result = PlaybookNodeInput.safeParse({ ...base, url: 'http://169.254.169.254/latest/meta-data/' });
        expect(result.success).toBe(false);
    });

    it('rejects an unknown mode', () => {
        const result = PlaybookNodeInput.safeParse({ ...base, mode: 'always' });
        expect(result.success).toBe(false);
    });
});

describe('PlaybookInput', () => {
    it('defaults to an empty, enabled playbook', () => {
        const result = PlaybookInput.safeParse({});
        expect(result.success).toBe(true);
        expect(result.data.nodes).toEqual([]);
        expect(result.data.enabled).toBe(true);
    });

    it('caps nodes at 40', () => {
        const nodes = Array.from({ length: 41 }, (_, i) => ({
            id: `n${i}`,
            order: i + 1,
            directive: `Adım ${i}`
        }));
        const result = PlaybookInput.safeParse({ nodes });
        expect(result.success).toBe(false);
    });
});

describe('normalizePlaybook', () => {
    it('sorts by order and renumbers densely from 1', () => {
        const result = normalizePlaybook([
            { id: 'c', order: 30, directive: 'Üçüncü' },
            { id: 'a', order: 1, directive: 'Birinci' },
            { id: 'b', order: 10, directive: 'İkinci' }
        ]);
        expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c']);
        expect(result.map((n) => n.order)).toEqual([1, 2, 3]);
    });

    it('drops nodes with a blank or missing directive', () => {
        const result = normalizePlaybook([
            { id: 'a', order: 1, directive: 'Kalır' },
            { id: 'b', order: 2, directive: '   ' },
            { id: 'c', order: 3 }
        ]);
        expect(result.map((n) => n.id)).toEqual(['a']);
    });

    it('trims the directive and normalizes empty attach/url to null', () => {
        const result = normalizePlaybook([
            { id: 'a', order: 1, directive: '  Boşluklu  ', url: '', attach: '  ' }
        ]);
        expect(result[0].directive).toBe('Boşluklu');
        expect(result[0].url).toBeNull();
        expect(result[0].attach).toBeNull();
    });

    it('defaults a missing mode to situational', () => {
        const result = normalizePlaybook([{ id: 'a', order: 1, directive: 'x' }]);
        expect(result[0].mode).toBe('situational');
    });

    it('returns an empty array for an empty or undefined input', () => {
        expect(normalizePlaybook([])).toEqual([]);
        expect(normalizePlaybook()).toEqual([]);
    });
});

/**
 * isTourNavigableUrl must agree with @repo/screen's trustKey (registrable
 * domain via tldts), not raw hostname comparison — see
 * packages/screen/src/cobrowse.test.js for the cross-package agreement test.
 * demo.salesai.example and www.salesai.example intentionally share one
 * registrable domain here, mirroring the real Cyberverse reference scenario
 * (demo.cyberverse.com.tr / www.cyberverse.com.tr).
 */
describe('isTourNavigableUrl', () => {
    const product = { websiteUrl: 'https://www.salesai.example', tourAllowedDomains: [] };

    it('allows a URL on the product website itself', () => {
        expect(isTourNavigableUrl('https://www.salesai.example/pricing', product)).toBe(true);
    });

    it('allows a subdomain that shares the same registrable domain — no allowlist entry needed', () => {
        expect(isTourNavigableUrl('https://demo.salesai.example/reports', product)).toBe(true);
    });

    it('rejects an unrelated domain', () => {
        expect(isTourNavigableUrl('https://untrusted.example/', product)).toBe(false);
    });

    it('allows a domain only present in tourAllowedDomains', () => {
        const withAllowlist = { ...product, tourAllowedDomains: ['partner.example'] };
        expect(isTourNavigableUrl('https://partner.example/demo', withAllowlist)).toBe(true);
    });

    it('rejects an unsafe URL (private IP) even if it would otherwise match', () => {
        expect(isTourNavigableUrl('http://127.0.0.1/', { websiteUrl: 'http://127.0.0.1' })).toBe(false);
    });

    it('rejects when no websiteUrl or allowlist is configured', () => {
        expect(isTourNavigableUrl('https://www.salesai.example/pricing', {})).toBe(false);
    });
});
