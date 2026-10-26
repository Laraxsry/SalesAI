import { describe, expect, it } from 'vitest';
import { annotateElements, describeState, renderPageGuide } from './ui-guide.js';

// Shapes taken from a real crawl of a logged-in panel.
const panelWithForm = {
    trigger: 'New variable',
    kind: 'content',
    newElements: [{ label: 'Cancel', kind: 'button' }, { label: 'Create variable', kind: 'button' }],
    form: {
        fields: [
            { label: 'Name', type: 'text', required: false },
            { label: 'Enter description (optional)', type: 'textarea', required: false }
        ],
        actions: [{ label: 'Cancel' }, { label: 'Create variable' }]
    }
};

describe('describeState', () => {
    it('describes a side panel by the form it asks for and its buttons', () => {
        expect(describeState(panelWithForm)).toBe(
            'Opens a panel with a form asking for: Name (text); Enter description (optional) (textarea); buttons: Cancel, Create variable.'
        );
    });

    it('describes a dialog by its title and form', () => {
        const state = { kind: 'dialog', title: 'New workflow', form: { fields: [{ label: 'Workflow name', type: 'text', required: true }], actions: [] } };

        expect(describeState(state)).toBe('Opens a dialog "New workflow" with a form asking for: Workflow name (text, required).');
    });

    it('describes a menu by its items, a navigation by its page, and a silent write', () => {
        expect(describeState({ kind: 'menu', newElements: [{ label: 'Rename' }, { label: 'Duplicate' }] })).toBe('Opens a menu with: Rename, Duplicate.');
        expect(describeState({ kind: 'navigation', targetUrl: 'https://app.example/project/6ab4ff6b5f3621fac23249f1/cms/flow' })).toBe('Goes to another page (/project/:id/cms/flow).');
        expect(describeState({ kind: 'write' })).toBe('Sends data to the server without changing what is shown.');
    });

    it('lists what appeared when a press only shows more on the page', () => {
        expect(describeState({ kind: 'content', newElements: [{ label: 'Resolution rate' }, { label: 'Customer satisfaction' }] })).toBe(
            'Shows more on the page: Resolution rate, Customer satisfaction.'
        );
    });
});

describe('annotateElements', () => {
    it('writes what pressing a button does onto that button, leaving its key and selector alone', () => {
        const components = {
            interactiveElements: [
                { label: 'New variable', kind: 'button', selector: 'button.x', elementKey: 'el_abc' },
                { label: 'Search', kind: 'button', selector: 'button.y', elementKey: 'el_def' }
            ],
            states: [panelWithForm]
        };

        annotateElements(components);

        expect(components.interactiveElements[0]).toMatchObject({ elementKey: 'el_abc', selector: 'button.x' });
        expect(components.interactiveElements[0].expected).toMatch(/^Opens a panel with a form/);
        expect(components.interactiveElements[1].expected).toBeUndefined();
    });

    it('does nothing for a page whose buttons were not pressed', () => {
        const components = { interactiveElements: [{ label: 'x' }] };

        expect(annotateElements(components)).toBe(components);
        expect(components.interactiveElements[0].expected).toBeUndefined();
    });
});

describe('renderPageGuide', () => {
    it('writes each finding of a page, with the element purpose when there is one', () => {
        const text = renderPageGuide({
            url: 'https://app.example/project/6ab4ff6b5f3621fac23249f1/cms/variable',
            components: {
                interactiveElements: [{ label: 'New variable', purpose: 'Adds a variable the agent can remember.' }],
                states: [panelWithForm, { trigger: 'Rename', kind: 'menu', newElements: [{ label: 'Delete' }] }]
            }
        });

        expect(text.split('\n')[0]).toBe('On the page /project/:id/cms/variable:');
        expect(text).toContain('- Pressing "New variable" (Adds a variable the agent can remember): Opens a panel with a form asking for');
        expect(text).toContain('- Pressing "Rename": Opens a menu with: Delete.');
    });

    it('is empty when the crawl found nothing worth saying', () => {
        expect(renderPageGuide({ url: 'https://app.example/x', components: { states: [] } })).toBe('');
        expect(renderPageGuide({ url: 'https://app.example/x', components: undefined })).toBe('');
    });
});
