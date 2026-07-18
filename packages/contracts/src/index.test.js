import { describe, it, expect } from 'vitest';
import { ProductInput } from './index.js';

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
