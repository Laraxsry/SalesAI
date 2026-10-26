import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { peekAtButtons, PEEK_CONFIG, countOverlays } from './state-discovery.js';

// Real-browser check: a page whose buttons open dialogs and menus, reveal content,
// navigate, write on their own, or do nothing. Skipped where Chromium is not installed.
const hasBrowser = existsSync(chromium.executablePath());
const ORIGIN = 'https://app.example';

const PAGE = `<!doctype html><html><body>
<header><button onclick="go('/from-header')">Header button</button></header>
<nav><button onclick="go('/from-nav')">Nav button</button></nav>
<main>
  <h1>Workflows</h1>
  <button onclick="openDialog()">Open composer</button>
  <button onclick="go('/created-item')">Create playbook</button>
  <div id="chips">
    <button onclick="fetch('/api/assistant', { method: 'POST' })">Which tools fail most often?</button>
    <button onclick="fetch('/api/assistant', { method: 'POST' })">Fix greeting</button>
  </div>
  <div id="days">
    <button onclick="layer('<div class=detail><button>Close detail</button></div>')">Sep 22</button>
    <button onclick="layer('<div class=detail><button>Close detail</button></div>')">Sep 23</button>
    <button onclick="layer('<div class=detail><button>Close detail</button></div>')">Oct 3</button>
  </div>
  <button onclick="openStubborn()">Configure</button>
  <button onclick="openStuck()">Stuck panel</button>
  <button onclick="toggleMenu()">More options</button>
  <div id="filterbox"><input placeholder="Filter the list"></div>
  <button onclick="openDrawer()">Open sidebar form</button>
  <button onclick="openRemounting()">Open remounting form</button>
  <button onclick="go('/templates')">Browse templates</button>
  <button onclick="document.getElementById('hint').hidden = false">Show hint</button>
  <button onclick="fetch('/api/workflows', { method: 'POST' })">Refresh list</button>
  <button onclick="location.hash = '#section'">Jump</button>
  <button>No effect</button>
  <button aria-expanded="false">Folding section</button>
  <button type="submit">Submit</button>
  <button>Delete everything</button>
  <div id="hint" hidden><button>Got it</button></div>
  <div id="layer"></div>
</main>
<script>
  function go(path) { history.pushState({}, '', path); }
  function layer(html) { document.getElementById('layer').innerHTML = html; }
  // Closes on Escape.
  function openDialog() {
    layer('<div role="dialog" aria-modal="true"><h2>New workflow</h2><label for=\\'wn\\'>Workflow name *</label><input id=\\'wn\\' placeholder="Workflow name" required><button onclick="layer(\\'\\')">Cancel</button><button>Create</button></div>');
  }
  // Ignores Escape; only its Close button works.
  function openStubborn() {
    layer('<div role="dialog"><h2>Configuration</h2><button onclick="layer(\\'\\')">Close</button><button>Apply</button></div>');
  }
  // Ignores Escape and has no close control at all; only a reload clears it.
  function openStuck() {
    layer('<div role="dialog"><h2>Please wait</h2><p>Working</p></div>');
  }
  // A real app re-renders part of the page when a panel opens, so a control that was already there
  // (the filter box) comes back as a NEW element.
  function openRemounting() {
    document.getElementById('filterbox').innerHTML = '<input placeholder="Filter the list">';
    openDrawer();
  }
  // A side panel: no dialog role, so it is found by the controls it adds.
  function openDrawer() {
    layer('<div class="drawer"><h3>Variable</h3><input placeholder="Enter variable name"><textarea placeholder="Enter description (optional)"></textarea><button onclick="layer(\\'\\')">Cancel</button><button>Create variable</button></div>');
  }
  function toggleMenu() {
    layer('<div role="menu"><button role="menuitem">Rename</button><button role="menuitem">Duplicate</button></div>');
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.querySelector('[role="dialog"] h2')?.textContent === 'New workflow') layer('');
    if (event.key === 'Escape') { const menu = document.querySelector('[role="menu"]'); if (menu) layer(''); }
  });
</script>
</body></html>`;

describe.skipIf(!hasBrowser)('peekAtButtons in a real browser', () => {
    let browser;
    let page;
    let result;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        await context.route('**/*', (route) => {
            if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
        });
        page = await context.newPage();
        await page.goto(`${ORIGIN}/home`);
        result = await peekAtButtons(page, `${ORIGIN}/home`, { settle: async () => {}, maxPeeks: 20 });
    });

    afterAll(async () => {
        await browser?.close();
    });

    const stateFor = (label) => result.states.find((state) => state.trigger === label);

    it('records a dialog with its title and the controls inside it', () => {
        const state = stateFor('Open composer');
        expect(state).toMatchObject({ kind: 'dialog', title: 'New workflow' });
        expect(state.newElements.map((item) => item.label)).toEqual(expect.arrayContaining(['Workflow name', 'Cancel', 'Create']));
    });

    it('reads the form of a dialog it opened, without filling or submitting it', () => {
        expect(stateFor('Open composer').form.fields).toEqual([
            expect.objectContaining({ label: 'Workflow name', type: 'text', required: true })
        ]);
        expect(stateFor('Open composer').form.actions.map((action) => action.label)).toEqual(['Cancel', 'Create']);
    });

    // Real finding: the demo panel's forms live in side panels with no dialog role, so the
    // form reader missed every one of them.
    it('reads the form of a side panel that is not a dialog, and not the page behind it', () => {
        const state = stateFor('Open sidebar form');
        expect(state.kind).toBe('content');
        expect(state.form.fields.map((field) => [field.label, field.type])).toEqual([
            ['Enter variable name', 'text'],
            ['Enter description (optional)', 'textarea']
        ]);
        expect(state.form.actions.map((action) => action.label)).toEqual(['Cancel', 'Create variable']);
    });

    // Real finding: on the demo panel the form was never found. Opening it re-renders the chat box next
    // to it, so a control that was already on the page counted as new and the "form" grew to cover the page.
    it('does not count a control the app re-created as part of the form that opened', () => {
        const state = stateFor('Open remounting form');
        expect(state.form.fields.map((field) => field.label)).toEqual(['Enter variable name', 'Enter description (optional)']);
    });

    it('records a menu with its items', () => {
        const state = stateFor('More options');
        expect(state.kind).toBe('menu');
        expect(state.newElements.map((item) => item.label)).toEqual(['Rename', 'Duplicate']);
    });

    it('records content that appears without a floating surface', () => {
        const state = stateFor('Show hint');
        expect(state.kind).toBe('content');
        expect(state.newElements.map((item) => item.label)).toContain('Got it');
    });

    it('records a press that goes somewhere else as a navigation, and offers the page as a link', () => {
        expect(stateFor('Browse templates')).toMatchObject({ kind: 'navigation', targetUrl: `${ORIGIN}/templates` });
        expect(result.links).toEqual([{ label: 'Browse templates', targetUrl: `${ORIGIN}/templates`, kind: 'button' }]);
    });

    it('records a press that writes data without changing what is on screen', () => {
        expect(stateFor('Refresh list')).toMatchObject({ kind: 'write', writeRequests: ['POST app.example/api/workflows'] });
    });

    it('records nothing for presses that change nothing or only jump within the page', () => {
        expect(stateFor('No effect')).toBeUndefined();
        expect(stateFor('Jump')).toBeUndefined();
    });

    it('never presses navigation chrome, folding sections, submits or destructive buttons', () => {
        for (const label of ['Header button', 'Nav button', 'Folding section', 'Submit', 'Delete everything']) {
            expect(stateFor(label), label).toBeUndefined();
        }
        expect(result.links.map((link) => link.targetUrl)).not.toContain(`${ORIGIN}/from-header`);
        expect(result.links.map((link) => link.targetUrl)).not.toContain(`${ORIGIN}/from-nav`);
    });

    // Real finding: pressing these created records and sent billed AI prompts on the demo account.
    it('does not press buttons that create something or send a suggested AI prompt', () => {
        expect(stateFor('Create playbook')).toBeUndefined();
        expect(stateFor('Which tools fail most often?')).toBeUndefined();
        expect(result.links.map((link) => link.targetUrl)).not.toContain(`${ORIGIN}/created-item`);
    });

    // Real finding: the Evaluations page has a button per day, and the crawl spent its whole budget on twelve of them.
    it('presses one button of each shape, not every "Sep 22", "Sep 23", "Oct 3"', () => {
        const days = result.states.filter((state) => /^(Sep|Oct) \d+$/.test(state.trigger));
        expect(days).toHaveLength(1);
    });

    // Real finding: "Fix greeting + language" is a short chip in a row of AI prompts, so no word or
    // question-mark rule stops it. The row it sits in gives it away.
    it('does not press a short chip that sits in a row of suggested AI prompts', () => {
        expect(stateFor('Fix greeting')).toBeUndefined();
    });

    it('closes what it opened — with Escape, with the close button, or by reloading — and ends on the page it started on', async () => {
        expect(stateFor('Configure')).toMatchObject({ kind: 'dialog', title: 'Configuration' });
        expect(stateFor('Stuck panel')).toMatchObject({ kind: 'dialog', title: 'Please wait' });
        await expect(page.evaluate(countOverlays, PEEK_CONFIG)).resolves.toBe(0);
        expect(page.url()).toBe(`${ORIGIN}/home`);
    });
});
