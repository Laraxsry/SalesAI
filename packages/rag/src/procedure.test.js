import { describe, expect, it } from 'vitest';
import { buildProcedure, pagePathOf, procedureLabels, procedureSlug, renderProcedureText, subjectOf } from './procedure.js';

// The shape of a real learning run on the Voiceflow demo panel (Variables → New variable), values shortened.
const learned = (overrides = {}) => ({
    trigger: 'New variable',
    listUrl: 'https://creator.voiceflow.com/project/6ab4ff6b5f3621fac23249f1/cms/variable',
    applied: true,
    steps: [
        { action: 'press', where: 'page', label: 'New variable' },
        { action: 'fill', label: 'Name', type: 'text', value: 'salesai-demo-8g9a14-name', ok: true },
        { action: 'fill', label: 'Enter description (optional)', type: 'textarea', value: 'salesai-demo-8g9a14-desc', ok: true },
        { action: 'press', where: 'form', label: 'Create variable' }
    ],
    errors: [],
    form: {
        fields: [
            { label: 'Name', type: 'text', required: false, placeholder: 'Enter variable name' },
            { label: 'Enter description (optional)', type: 'textarea', required: false, placeholder: 'Enter description (optional)' },
            { label: '', type: 'checkbox', required: false }
        ],
        actions: [
            { label: 'Cancel', kind: 'button' },
            { label: 'Create variable', kind: 'button' }
        ]
    },
    commit: { label: 'Create variable', kind: 'button' },
    attempts: [{ needle: 'salesai-demo-8g9a14-name', status: 'created', errors: [] }],
    outcome: { status: 'created', notices: [], errors: [], appeared: [] },
    deleteFlow: {
        steps: [
            { action: 'press', where: 'row', label: '(icon button)' },
            { action: 'press', where: 'menu', label: 'Delete' },
            { action: 'press', where: 'confirmation', label: 'Delete' }
        ],
        confirmation: { title: 'Delete variable', text: 'Delete variable Confirm you want to delete this variable.' }
    },
    ...overrides
});

describe('buildProcedure', () => {
    it('turns a flow that was created and undone into a structured recipe', () => {
        const { ok, procedure } = buildProcedure(learned(), { now: new Date('2026-10-21T12:00:00Z') });

        expect(ok).toBe(true);
        expect(procedure).toMatchObject({
            slug: 'cms-variable--new-variable',
            kind: 'create',
            title: 'Create a variable',
            pagePath: '/project/:id/cms/variable',
            trigger: 'New variable'
        });
        expect(procedure.steps.map((step) => `${step.n}:${step.action}:${step.label || step.path}`)).toEqual([
            '1:open:/project/:id/cms/variable',
            '2:press:New variable',
            '3:fill:Name',
            '4:fill:Enter description (optional)',
            '5:press:Create variable'
        ]);
        expect(procedure.form).toEqual({
            fields: [
                { label: 'Name', type: 'text', required: false, placeholder: 'Enter variable name' },
                { label: 'Enter description (optional)', type: 'textarea', required: false }
            ],
            submit: 'Create variable',
            cancel: 'Cancel'
        });
        expect(procedure.undo.steps.map((step) => `${step.where}:${step.label}`)).toEqual(['row:(icon button)', 'menu:Delete', 'confirmation:Delete']);
        expect(procedure.learnedAt).toEqual(new Date('2026-10-21T12:00:00Z'));
    });

    it('leaves out a field that has no label (nothing to tell the agent about it)', () => {
        const { procedure } = buildProcedure(learned());

        expect(procedure.form.fields.map((field) => field.label)).toEqual(['Name', 'Enter description (optional)']);
    });

    // Only a flow seen through both ways becomes a recipe: nobody should follow one whose end nobody has tried.
    it('refuses a flow that was only read, never carried out', () => {
        expect(buildProcedure(learned({ applied: false }))).toEqual({ ok: false, reason: expect.stringMatching(/only read/) });
    });

    it('refuses a flow whose save did not create anything', () => {
        const result = buildProcedure(learned({ outcome: { status: 'rejected', notices: [], errors: ['Name is required'] } }));

        expect(result).toEqual({ ok: false, reason: expect.stringMatching(/did not create/) });
    });

    it('refuses a flow whose undo was never seen', () => {
        expect(buildProcedure(learned({ deleteFlow: null }))).toEqual({ ok: false, reason: expect.stringMatching(/undo/) });
    });

    // Real finding: an early run recorded the modal's message as "CancelDelete" (just its two buttons).
    it('drops a confirmation message that is only the buttons own labels', () => {
        const { procedure } = buildProcedure(learned({
            deleteFlow: {
                steps: [{ action: 'press', where: 'confirmation', label: 'Delete' }],
                confirmation: { title: 'CancelDelete', text: 'CancelDelete' }
            }
        }));

        expect(procedure.undo.confirmation).toBeUndefined();
    });

    it('does not repeat the title inside the message', () => {
        const { procedure } = buildProcedure(learned({
            deleteFlow: {
                steps: [{ action: 'press', where: 'confirmation', label: 'Delete' }],
                confirmation: { title: 'Delete variable', text: 'Delete variable Confirm you want to delete this variable.' }
            }
        }));

        expect(procedure.undo.confirmation).toEqual({ title: 'Delete variable', text: 'Confirm you want to delete this variable.' });
    });

    it('records that a first attempt was rejected and what the accepted name looks like', () => {
        const { procedure } = buildProcedure(learned({
            attempts: [
                { needle: 'a-b', status: 'rejected', errors: ['Only letters, numbers and underscores'] },
                { needle: 'a_b', status: 'created', errors: [] }
            ]
        }));

        expect(procedure.expect.nameRule).toEqual({
            rejectedWith: ['Only letters, numbers and underscores'],
            acceptedStyle: 'letters, digits and underscores only'
        });
    });

    it('marks a required field as required in its fill step', () => {
        const result = learned();
        result.form.fields[0].required = true;

        const { procedure } = buildProcedure(result);

        expect(procedure.steps.find((step) => step.label === 'Name').required).toBe(true);
    });
});

describe('helpers', () => {
    it('writes a project id as :id so a recipe reads the same on any project', () => {
        expect(pagePathOf('https://app.example/project/6ab4ff6b5f3621fac23249f1/cms/variable?x=1')).toBe('/project/:id/cms/variable');
    });

    it('builds a slug from the last two path segments and the button', () => {
        expect(procedureSlug({ pageUrl: 'https://app.example/project/6ab4ff6b5f3621fac23249f1/cms/flow', trigger: 'Create workflow' })).toBe('cms-flow--create-workflow');
    });

    it('names what a button creates', () => {
        expect(subjectOf('New variable')).toBe('variable');
        expect(subjectOf('Create new number')).toBe('new number');
        expect(subjectOf('Import')).toBe('Import');
    });
});

describe('renderProcedureText', () => {
    const text = (options, language = 'en') => renderProcedureText(buildProcedure(learned(), { language }).procedure, options);

    it('writes every step with the exact button labels', () => {
        const output = text();

        expect(output).toContain('How to create a variable on the page /project/:id/cms/variable');
        expect(output).toContain('1. Open the page https://creator.voiceflow.com/project/6ab4ff6b5f3621fac23249f1/cms/variable.');
        expect(output).toContain('2. Press "New variable". A form opens asking for: Name (text), Enter description (optional) (textarea).');
        expect(output).toContain('Fill in "Name", "Enter description (optional)".');
        expect(output).toContain('Press "Create variable".');
        expect(output).toContain('Result: a new entry appears in the list.');
    });

    it('describes how to undo it, including the confirmation the page asks', () => {
        const output = text();

        expect(output).toContain('To undo it: press the icon button at the end of the row (usually "⋯") → choose "Delete" from the menu that opens → confirm with "Delete"');
        expect(output).toContain('Confirm you want to delete this variable.');
    });

    it('puts what the flow is for first, when it is known', () => {
        const output = text({ description: 'Variables hold values the agent remembers during a conversation.' });

        expect(output.split('\n')[1]).toBe('Variables hold values the agent remembers during a conversation.');
    });

    it('separates required fields from optional ones', () => {
        const result = learned();
        result.form.fields[0].required = true;
        const output = renderProcedureText(buildProcedure(result).procedure);

        expect(output).toContain('Fill in "Name".');
        expect(output).toContain('Optionally also fill in "Enter description (optional)".');
        expect(output).toContain('Name (text, required)');
    });

    it('writes the same recipe in Turkish', () => {
        const output = text({}, 'tr');

        expect(output).toContain('sayfasında variable oluştur nasıl yapılır');
        expect(output).toContain('"New variable" düğmesine bas.');
        expect(output).toContain('Name (metin)');
        expect(output).toContain('Sonuç: listede yeni bir kayıt görünür.');
        expect(output).toContain('Geri almak için:');
    });

    it('mentions a page notice when there was one', () => {
        const result = learned({ outcome: { status: 'created', notices: ['Variable created'], errors: [] } });

        expect(renderProcedureText(buildProcedure(result).procedure)).toContain('the page says "Variable created"');
    });
});

describe('procedureLabels', () => {
    it('lists each button the recipe presses or undoes with, once, without icon placeholders', () => {
        const labels = procedureLabels({
            steps: [{ action: 'open' }, { action: 'press', label: 'New variable' }, { action: 'fill', label: 'Name' }, { action: 'press', label: 'Create variable' }],
            undo: { steps: [{ action: 'press', label: '(icon button)' }, { action: 'press', label: 'Delete' }, { action: 'press', label: 'Delete' }] }
        });
        expect(labels).toEqual(['New variable', 'Create variable', 'Delete']);
    });
});

describe('what is kept with each pressed step', () => {
    it('records the kind of element, and its purpose when one is given', () => {
        const { procedure } = buildProcedure(learned(), { purposes: { 'New variable': 'Opens a form to add a variable.' } });
        const trigger = procedure.steps.find((step) => step.action === 'press' && step.where === 'page');
        expect(trigger).toMatchObject({ role: 'button', purpose: 'Opens a form to add a variable.' });
        expect(procedure.steps.find((step) => step.where === 'form' && step.action === 'press').purpose).toBeUndefined();
        expect(procedure.undo.steps.every((step) => ['button', 'menuitem'].includes(step.role))).toBe(true);
    });

    it('does not change which labels a demo may press', () => {
        const plain = buildProcedure(learned()).procedure;
        const described = buildProcedure(learned(), { purposes: { 'New variable': 'x' } }).procedure;
        expect(procedureLabels(described)).toEqual(procedureLabels(plain));
    });
});
