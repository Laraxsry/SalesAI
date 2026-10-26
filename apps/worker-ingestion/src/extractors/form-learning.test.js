import { describe, expect, it } from 'vitest';
import { demoValueFor, LEARNING_PREFIX, planFormFill } from './form-learning.js';

const field = (overrides) => ({ label: 'Name', type: 'text', required: false, ...overrides });

describe('demoValueFor', () => {
    it('marks what it creates with the learning prefix so it can be found and cleaned up', () => {
        expect(demoValueFor(field({ label: 'Workflow name' }))).toBe(`${LEARNING_PREFIX}workflow-name`);
        expect(demoValueFor(field({ type: 'textarea', label: 'Description' }))).toMatch(new RegExp(`^${LEARNING_PREFIX}description`));
        expect(demoValueFor(field({ type: 'email', label: 'Contact' }))).toBe(`${LEARNING_PREFIX}user@example.com`);
    });

    it('uses a valid value for each input type', () => {
        const today = new Date('2026-10-21T08:00:00Z');
        expect(demoValueFor(field({ type: 'url' }), { today })).toBe('https://example.com/salesai-demo');
        expect(demoValueFor(field({ type: 'number' }), { today })).toBe('1');
        expect(demoValueFor(field({ type: 'date' }), { today })).toBe('2026-10-21');
        expect(demoValueFor(field({ type: 'datetime-local' }), { today })).toBe('2026-10-21T10:00');
        expect(demoValueFor(field({ type: 'tel' }), { today })).toMatch(/^\+\d+$/);
    });

    it('never makes up a credential or a payment detail', () => {
        for (const label of ['Password', 'API key', 'Client secret', 'Card number', 'Şifre', 'IBAN']) {
            expect(demoValueFor(field({ label })), label).toBeUndefined();
        }
        expect(demoValueFor(field({ type: 'password', label: 'Anything' }))).toBeUndefined();
        expect(demoValueFor(field({ type: 'file', label: 'Upload' }))).toBeUndefined();
    });

    it('picks the first real option, skipping a "Select…" placeholder', () => {
        expect(demoValueFor(field({ type: 'select', options: ['Select a type', 'Text', 'File'] }))).toBe('Text');
        expect(demoValueFor(field({ type: 'select', options: ['Seçiniz', 'Bir'] }))).toBe('Bir');
        expect(demoValueFor(field({ type: 'select', options: ['Select…'] }))).toBeUndefined();
    });

    it('leaves optional toggles alone but switches a required one on', () => {
        expect(demoValueFor(field({ type: 'checkbox', required: false }))).toBeUndefined();
        expect(demoValueFor(field({ type: 'checkbox', required: true, label: 'I agree' }))).toBe(true);
    });

    it('writes an underscore name when the prefix is an identifier', () => {
        expect(demoValueFor(field({ label: 'Variable name' }), { prefix: 'salesai_demo_run1_' })).toBe('salesai_demo_run1_variable_name');
        expect(demoValueFor(field({ label: 'Variable name' }), { prefix: 'salesai-demo-run1-' })).toBe('salesai-demo-run1-variable-name');
    });

    it('falls back to a generic name when the field has no label', () => {
        expect(demoValueFor(field({ label: '' }))).toBe(`${LEARNING_PREFIX}item`);
    });
});

describe('planFormFill', () => {
    it('pairs each field with its value and skips fields left alone', () => {
        const plan = planFormFill([
            field({ label: 'Name' }),
            field({ label: 'Password', type: 'password' }),
            field({ label: 'Kind', type: 'select', options: ['Pick one', 'Basic'] })
        ]);

        expect(plan.map((step) => [step.field.label, step.value])).toEqual([
            ['Name', `${LEARNING_PREFIX}name`],
            ['Kind', 'Basic']
        ]);
    });

    it('takes values from another provider when given one', () => {
        const plan = planFormFill([field({ label: 'Name' })], { provider: () => 'from an LLM' });

        expect(plan).toEqual([{ field: expect.objectContaining({ label: 'Name' }), value: 'from an LLM' }]);
    });
});
