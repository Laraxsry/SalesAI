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

    describe('inside a learned procedure', () => {
        const button = (name, rowText = '', extra = {}) => ({ role: 'button', name, line: `button "${name}"`, rowText, ...extra });
        const begin = (labels = ['Add', 'Save', 'Delete']) => {
            const scoped = new BrowserActionPolicy();
            scoped.beginProcedure({ id: 'p1', labels });
            return scoped;
        };

        it('lets recipe labels through, including a form Save', () => {
            const scoped = begin();
            expect(scoped.assertAllowed({ action: 'click', element: button('Save', '', { insideForm: true }) }).allowed).toBe(true);
        });

        it('refuses a removal when nothing of the demo is selected', () => {
            const scoped = begin();
            expect(() => scoped.assertAllowed({ action: 'click', element: button('Delete', 'old customer variable') }))
                .toThrow(/nothing the demo created/);
        });

        it('allows a removal on a row carrying the demo marker', () => {
            const scoped = begin();
            expect(scoped.assertAllowed({ action: 'click', element: button('Delete', 'row salesai-demo-abc12-name') }).classification)
                .toBe('procedure_removal');
        });

        it('stays armed for a confirmation dialog, then runs out', () => {
            const scoped = begin();
            scoped.assertAllowed({ action: 'click', element: button('Row menu', 'row salesai-demo-abc12-name') });
            expect(scoped.assertAllowed({ action: 'click', element: button('Delete', 'menu') }).allowed).toBe(true);
            expect(scoped.assertAllowed({ action: 'click', element: button('Delete', 'dialog') }).allowed).toBe(true);
            expect(scoped.assertAllowed({ action: 'click', element: button('Delete', 'dialog') }).allowed).toBe(true);
            expect(() => scoped.assertAllowed({ action: 'click', element: button('Delete', 'dialog') })).toThrow(/nothing the demo created/);
        });

        it('does not widen to labels outside the recipe', () => {
            const scoped = begin();
            const marked = 'row salesai-demo-abc12-name';
            expect(() => scoped.assertAllowed({ action: 'click', element: button('Delete workspace', marked) })).toThrow(/destructive/);
            expect(() => scoped.assertAllowed({ action: 'click', element: button('Hesabı Sil', marked) })).toThrow(/destructive/);
        });

        it('closes the door when the procedure ends', () => {
            const scoped = begin();
            scoped.endProcedure();
            expect(() => scoped.assertAllowed({ action: 'click', element: button('Delete', 'row salesai-demo-abc12-name') })).toThrow(/destructive/);
        });
    });
});
