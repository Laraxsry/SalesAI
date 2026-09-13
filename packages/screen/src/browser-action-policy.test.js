import { describe, expect, it } from 'vitest';
import { BrowserActionPolicy } from './browser-action-policy.js';

describe('BrowserActionPolicy', () => {
    const policy = new BrowserActionPolicy();

    it('allows ordinary presentation navigation', () => {
        expect(policy.assertAllowed({
            action: 'click',
            element: { role: 'button', name: 'Raporlar', line: 'button "Raporlar"' }
        }).allowed).toBe(true);
    });

    it('blocks destructive model clicks but permits scoped system tasks', () => {
        const element = { role: 'button', name: 'Hesabı Sil', line: 'button "Hesabı Sil"' };
        expect(() => policy.assertAllowed({ action: 'click', element })).toThrow(/destructive/);
        expect(policy.assertAllowed({ action: 'click', element, capability: 'system:cookie' }).allowed).toBe(true);
    });
});
