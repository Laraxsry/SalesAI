import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { extractOverlayForm } from './form-learning.js';
import { PEEK_CONFIG } from './state-discovery.js';

// Real-browser check of the form reader against the ways a form labels its fields.
// Skipped where Chromium is not installed.
const hasBrowser = existsSync(chromium.executablePath());

const FORM = `<!doctype html><html><body>
<p>Behind the dialog</p><input placeholder="Search the page">
<div role="dialog" aria-modal="true">
  <h2>New agent</h2>
  <label for="n">Agent name *</label><input id="n" required>
  <label>Description <textarea></textarea></label>
  <input aria-label="Contact email" type="email">
  <label>Kind
    <select><option>Select a kind</option><option>Voice</option><option>Chat</option></select>
  </label>
  <fieldset><legend>Visibility</legend>
    <label><input type="radio" name="vis" value="a"> Private</label>
    <label><input type="radio" name="vis" value="b"> Team</label>
  </fieldset>
  <label><input type="checkbox"> Enable logging</label>
  <input type="password" aria-label="Admin password">
  <input type="hidden" name="csrf" value="x">
  <input placeholder="Optional nickname">
  <div style="display:none"><input aria-label="Hidden field"></div>
  <button>Cancel</button>
  <button type="submit">Create agent</button>
</div>
</body></html>`;

describe.skipIf(!hasBrowser)('extractOverlayForm in a real browser', () => {
    let browser;
    let form;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(FORM);
        form = await page.evaluate(extractOverlayForm, PEEK_CONFIG);
    });

    afterAll(async () => {
        await browser?.close();
    });

    const fieldFor = (label) => form.fields.find((item) => item.label === label);

    it('reads a for/id label and treats a trailing * as required', () => {
        expect(fieldFor('Agent name')).toMatchObject({ type: 'text', required: true });
    });

    it('reads a wrapping label without the control text inside it', () => {
        expect(fieldFor('Description')).toMatchObject({ type: 'textarea', required: false });
        expect(fieldFor('Kind').options).toEqual(['Select a kind', 'Voice', 'Chat']);
    });

    it('reads aria-label and placeholder fields with their type', () => {
        expect(fieldFor('Contact email')).toMatchObject({ type: 'email' });
        expect(fieldFor('Optional nickname')).toMatchObject({ type: 'text', placeholder: 'Optional nickname' });
    });

    it('turns a radio group into one field with its choices, named by the legend', () => {
        expect(fieldFor('Visibility')).toMatchObject({ type: 'radio', options: ['Private', 'Team'] });
        expect(form.fields.filter((item) => item.type === 'radio')).toHaveLength(1);
    });

    it('reports checkboxes and password fields (so they can be left alone) but not hidden inputs', () => {
        expect(fieldFor('Enable logging')).toMatchObject({ type: 'checkbox' });
        expect(fieldFor('Admin password')).toMatchObject({ type: 'password' });
        expect(form.fields.some((item) => item.label === 'csrf')).toBe(false);
    });

    it('reads only the open dialog: not the page behind it and not hidden fields', () => {
        expect(form.fields.some((item) => item.label === 'Search the page')).toBe(false);
        expect(form.fields.some((item) => item.label === 'Hidden field')).toBe(false);
    });

    it('lists the dialog buttons so the submit action can be told from cancel', () => {
        expect(form.actions).toEqual([
            { label: 'Cancel', kind: 'button' },
            { label: 'Create agent', kind: 'submit' }
        ]);
    });
});
