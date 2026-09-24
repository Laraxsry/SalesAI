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

    it('permits opening a form but blocks its generic Add submit', () => {
        const opening = { role: 'button', name: 'Add', line: 'button "Add"', insideForm: false };
        const submit = { ...opening, insideForm: true };
        expect(policy.assertAllowed({ action: 'click', element: opening }).allowed).toBe(true);
        expect(() => policy.assertAllowed({ action: 'click', element: submit }))
            .toThrow(/form submit/);
    });
});
