import { existsSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { learnCreateFlow, safePrefix, sweepOwnedRows } from './learning-run.js';
import { LEARNING_PREFIX } from './form-learning.js';

// Real browser, against a small fake panel: a list that keeps its rows across reloads, a side-panel
// form (no dialog role), a server-style validation error, and two ways to delete a row (a trash
// button on the row, or a "⋯" menu), each followed by a confirmation dialog.
const hasBrowser = existsSync(chromium.executablePath());
const ORIGIN = 'https://app.example';

const APP = `<!doctype html><html><head><style>
  .pop { position: absolute; background: white; border: 1px solid #ccc; padding: 4px; z-index: 10; }
  .pop div { padding: 6px 12px; cursor: pointer; }
  .trash { display: none; }
  .row:hover .trash { display: inline-block; }
</style></head><body>
<main>
  <!-- A Cancel/Delete pair that is part of the page, not a modal: it must never be taken for a confirmation. -->
  <div style="position:absolute; top:640px; right:8px"><button>Cancel</button><button onclick="localStorage.clear(); render()">Delete</button></div>
  <h1>Variables</h1>
  <button id="new" onclick="openForm()">New variable</button>
  <button id="noop" onclick="toast('Nothing opened')">No form here</button>
  <div id="list"></div>
  <div id="panel"></div>
  <div id="menu"></div>
  <div id="toast" role="status" aria-live="polite"></div>
  <!-- Far from any row menu. If anything presses it, the list is wiped. -->
  <button style="position:absolute; top:0; left:0" onclick="localStorage.clear(); render()">Delete</button>
</main>
<script>
  const mode = new URLSearchParams(location.search).get('mode') || 'inline';
  // Some panels only accept identifiers (letters, digits, underscores) as names.
  const strict = new URLSearchParams(location.search).get('strict') === '1';
  const items = () => JSON.parse(localStorage.getItem('items') || '[]');
  const save = (list) => { localStorage.setItem('items', JSON.stringify(list)); render(); };
  const toast = (text) => { document.getElementById('toast').textContent = text; };

  function render() {
    document.getElementById('list').innerHTML = items().map((name, i) =>
      mode === 'plainmodal'
        // Plain menu AND a plain modal (no roles) for the confirmation, as on the real panel.
        ? '<div class="row"><span class="chip">{ ' + name + ' }</span><button onclick="openPlainMenu(' + i + ', this, true)"><svg width="12" height="12"></svg></button></div>'
      : mode === 'plainmenu'
        // Plain elements, no roles: a menu that only looks like one.
        ? '<div class="row"><span class="chip">{ ' + name + ' }</span><button onclick="openPlainMenu(' + i + ', this)"><svg width="12" height="12"></svg></button></div>'
      : mode === 'chip'
        // The real panel: the name is shown as a chip, the row ends in an icon-only "⋯" button with no label.
        ? '<div class="row"><span class="chip">{ ' + name + ' }</span><button onclick="openMenu(' + i + ')"><svg width="12" height="12"></svg></button></div>'
      : mode === 'editable'
        // Names are edited in place (an input, no text) and the trash button only shows under the pointer.
        ? '<div class="row"><input value="' + name + '" readonly><button class="trash" aria-label="Delete variable" onclick="askDelete(' + i + ')">🗑</button></div>'
      : mode === 'nodelete'
        ? '<div class="row"><span>' + name + '</span></div>'
      : mode === 'menu'
        ? '<div class="row"><span>' + name + '</span><button aria-label="More options" aria-haspopup="menu" onclick="openMenu(' + i + ')">⋯</button></div>'
        : '<div class="row"><span>' + name + '</span><button aria-label="Delete variable" onclick="askDelete(' + i + ')">🗑</button></div>'
    ).join('');
  }
  function openPlainMenu(i, button, confirmFirst) {
    const r = button.getBoundingClientRect();
    const act = confirmFirst ? 'askPlain(' + i + ')' : 'doDelete(' + i + ')';
    document.getElementById('menu').innerHTML =
      '<div class="pop" style="left:' + (r.right + scrollX - 160) + 'px; top:' + (r.bottom + scrollY + 4) + 'px">' +
      '<div>Rename</div><div>Duplicate</div><div onclick="' + act + '"><svg width="10" height="10"></svg><span>Delete</span></div></div>';
  }
  // A modal drawn from plain elements: a fixed backdrop and a fixed box, no dialog role.
  function askPlain(i) {
    document.getElementById('menu').innerHTML = '';
    document.getElementById('panel').innerHTML =
      '<div style="position:fixed; inset:0; background:rgba(0,0,0,.3)"></div>' +
      '<div style="position:fixed; top:20px; left:30%; background:white; padding:16px; width:360px">' +
      '<div class="head"><h4>Delete variable</h4></div><div class="body">Confirm you want to delete this variable.</div>' +
      '<div class="foot"><button onclick="closePanel()">Cancel</button><button onclick="doDelete(' + i + ')">Delete</button></div></div>';
  }
  function openMenu(i) {
    // In the real panel the menu's Delete removes the row at once; elsewhere it asks first.
    const act = mode === 'chip' ? 'doDelete(' + i + ')' : 'askDelete(' + i + ')';
    document.getElementById('menu').innerHTML =
      '<div role="menu"><button role="menuitem">Rename</button><button role="menuitem" onclick="' + act + '">Delete</button></div>';
  }
  function askDelete(i) {
    document.getElementById('menu').innerHTML = '';
    document.getElementById('panel').innerHTML =
      '<div role="dialog" aria-modal="true"><h2>Delete variable?</h2><p>This cannot be undone.</p>' +
      '<button onclick="closePanel()">Cancel</button><button onclick="doDelete(' + i + ')">Delete</button></div>';
  }
  function doDelete(i) {
    const list = items(); list.splice(i, 1);
    // With stale=1 the menu stays open after the choice, as a sloppy app might leave it.
    if (!new URLSearchParams(location.search).get('stale')) document.getElementById('menu').innerHTML = '';
    closePanel(); save(list); toast('Variable deleted');
  }
  function closePanel() { document.getElementById('panel').innerHTML = ''; }

  function openForm() {
    document.getElementById('panel').innerHTML =
      '<div class="drawer"><h3>New variable</h3>' +
      '<input id="name" placeholder="Enter variable name">' +
      '<textarea id="desc" placeholder="Enter description (optional)"></textarea>' +
      '<div id="err"></div>' +
      '<button onclick="closePanel()">Cancel</button><button onclick="create()">Create variable</button></div>';
  }
  function create() {
    const name = document.getElementById('name').value.trim();
    if (!name) { document.getElementById('err').innerHTML = '<p role="alert">Name is required</p>'; return; }
    if (strict && /[^A-Za-z0-9_]/.test(name)) { document.getElementById('err').innerHTML = '<p role="alert">Only letters, numbers and underscores</p>'; return; }
    if (name.includes('!')) { document.getElementById('err').innerHTML = '<p role="alert">Invalid name: no special characters</p>'; return; }
    // The real panel drops every character that is not a letter, digit or underscore from a variable name.
    save([...items(), mode === 'chip' ? name.replace(/[^A-Za-z0-9_]/g, '') : name]); closePanel(); toast('Variable created');
  }
  render();
</script>
</body></html>`;

describe.skipIf(!hasBrowser)('learnCreateFlow in a real browser', () => {
    let browser;
    let context;
    let page;

    const settle = async () => {};
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('items') || '[]'));
    const seed = (items) => context.addInitScript((list) => {
        if (!localStorage.getItem('items')) localStorage.setItem('items', JSON.stringify(list));
    }, items);
    const open = async (mode = 'inline') => {
        await page.goto(`${ORIGIN}/variables?mode=${mode}`);
    };

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
    });

    afterAll(async () => {
        await browser?.close();
    });

    async function freshPage(initialItems = ['keep-me']) {
        await context?.close();
        context = await browser.newContext();
        await context.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: APP }));
        await seed(initialItems);
        page = await context.newPage();
        await open();
    }

    afterEach(async () => {
        await context?.close();
        context = null;
    });

    const run = (overrides = {}) =>
        learnCreateFlow(page, { listUrl: `${ORIGIN}/variables?mode=${overrides.mode || 'inline'}`, trigger: 'New variable', settle, runId: 'run1', ...overrides });

    describe('without apply', () => {
        it('reads the form and plans the values, but creates nothing and leaves the page as it was', async () => {
            await freshPage();

            const result = await run();

            expect(result.applied).toBe(false);
            expect(result.form.fields.map((field) => field.label)).toEqual(['Enter variable name', 'Enter description (optional)']);
            expect(result.plan[0]).toMatchObject({ label: 'Enter variable name', value: `${LEARNING_PREFIX}run1-enter-variable-name` });
            expect(result.commit).toEqual({ label: 'Create variable', kind: 'button' });
            expect(await stored()).toEqual(['keep-me']);
            expect(await page.locator('.drawer').count()).toBe(0);
        });

        it('says what happened instead when pressing the button opens no form', async () => {
            await freshPage();

            const result = await run({ trigger: 'No form here' });

            expect(result.errors[0]).toMatch(/did not open a form/);
            expect(result.diagnostics).toMatchObject({ urlChanged: false, openSurfaces: [] });
            expect(await stored()).toEqual(['keep-me']);
        });

        it('reports a trigger that is not on the page instead of guessing', async () => {
            await freshPage();

            const result = await run({ trigger: 'Does not exist' });

            expect(result.errors[0]).toMatch(/no visible button labelled "Does not exist"/);
        });
    });

    describe('with apply', () => {
        it('creates a row, records what the page said, deletes the row through the trash button and confirmation, and touches nothing else', async () => {
            await freshPage();

            const result = await run({ apply: true });

            expect(result.errors).toEqual([]);
            expect(result.outcome).toMatchObject({ status: 'created', notices: ['Variable created'] });
            expect(result.deleteFlow.steps).toEqual([
                { action: 'press', where: 'row', label: 'Delete variable' },
                { action: 'press', where: 'confirmation', label: 'Delete' }
            ]);
            expect(result.deleteFlow.confirmation.title).toBe('Delete variable?');
            expect(result.steps.filter((step) => step.action === 'fill').map((step) => step.label)).toEqual([
                'Enter variable name',
                'Enter description (optional)'
            ]);
            expect(result.cleanup).toEqual({ deleted: 0, left: 0 });
            // Only what was there before.
            expect(await stored()).toEqual(['keep-me']);
        });

        it('finds the way to delete through a row menu when there is no trash button', async () => {
            await freshPage();
            await open('menu');

            const result = await run({ apply: true, mode: 'menu' });

            expect(result.errors).toEqual([]);
            expect(result.deleteFlow.steps.map((step) => `${step.where}:${step.label}`)).toEqual([
                'row:More options',
                'menu:Delete',
                'confirmation:Delete'
            ]);
            expect(await stored()).toEqual(['keep-me']);
        });

        // Real finding on the demo panel: the created row was not found (its name is in an input box, which
        // has no text) and its delete button was not found (it only shows under the pointer).
        it('finds a row whose name sits in an input box, and a delete button that shows only on hover', async () => {
            await freshPage();
            await open('editable');

            const result = await run({ apply: true, mode: 'editable' });

            expect(result.errors).toEqual([]);
            expect(result.outcome.status).toBe('created');
            expect(result.deleteFlow.steps.map((step) => `${step.where}:${step.label}`)).toEqual([
                'row:Delete variable',
                'confirmation:Delete'
            ]);
            expect(await stored()).toEqual(['keep-me']);
        });

        // Real findings on the demo panel: the name comes back with its hyphens removed, and the way to delete
        // is an icon-only "⋯" at the end of the row, which deletes at once.
        it('finds a row whose name the panel rewrote, and deletes it through an unlabeled icon button', async () => {
            await freshPage();
            await open('chip');

            const result = await run({ apply: true, mode: 'chip' });

            expect(result.errors).toEqual([]);
            expect(result.outcome.status).toBe('created');
            expect(result.deleteFlow.steps).toEqual([
                { action: 'press', where: 'row', label: '(icon button)' },
                { action: 'press', where: 'menu', label: 'Delete' }
            ]);
            expect(result.cleanup).toEqual({ deleted: 0, left: 0 });
            expect(await stored()).toEqual(['keep-me']);
        });

        // Real risk: a menu that stays open after its choice looked like a confirmation, and its "Delete" was pressed again.
        it('does not take a menu that is still open for a confirmation and press its Delete a second time', async () => {
            await freshPage();

            const result = await run({ apply: true, listUrl: `${ORIGIN}/variables?mode=chip&stale=1` });

            expect(result.errors).toEqual([]);
            expect(result.deleteFlow.steps.map((step) => `${step.where}:${step.label}`)).toEqual(['row:(icon button)', 'menu:Delete']);
        });

        // Real finding on the demo panel: the row's menu opened (Rename, Duplicate, Export, Copy link, Delete) but its
        // items carry no menu roles, so the run saw an empty menu and gave up.
        it('finds the Delete of a menu made of plain elements, and never a Delete elsewhere on the page', async () => {
            await freshPage();
            await open('plainmenu');

            const result = await run({ apply: true, mode: 'plainmenu' });

            expect(result.errors).toEqual([]);
            expect(result.deleteFlow.steps.map((step) => `${step.where}:${step.label}`)).toEqual(['row:(icon button)', 'menu:Delete']);
            // The decoy "Delete" at the top left would have wiped the list, "keep-me" with it.
            expect(await stored()).toEqual(['keep-me']);
        });

        // Real finding on the demo panel: "Delete variable — Confirm you want to delete this variable." is drawn from plain
        // elements, so the run never saw it, and reported that the row was "still on the page".
        it('confirms a deletion in a modal that is plain elements, not a dialog role, and not a lookalike pair elsewhere', async () => {
            await freshPage();
            await open('plainmodal');

            const result = await run({ apply: true, mode: 'plainmodal' });

            expect(result.errors).toEqual([]);
            expect(result.deleteFlow.steps.map((step) => `${step.where}:${step.label}`)).toEqual([
                'row:(icon button)',
                'menu:Delete',
                'confirmation:Delete'
            ]);
            // The real modal keeps its buttons in a footer apart from its title and message; both must be read.
            // Read as the lines a person sees: a word the title shares with a button ("Delete") stays whole.
            expect(result.deleteFlow.confirmation).toEqual({ title: 'Delete variable', text: 'Confirm you want to delete this variable.' });
            // The page's own Cancel/Delete pair would have wiped the list, "keep-me" with it.
            expect(await stored()).toEqual(['keep-me']);
        });

        it('says why when the row it made cannot be deleted, instead of just giving up', async () => {
            await freshPage();
            await open('nodelete');

            const result = await run({ apply: true, mode: 'nodelete' });

            expect(result.outcome.status).toBe('created');
            expect(result.deleteFlow).toBeNull();
            expect(result.deleteTrace.reason).toMatch(/no row with controls|no delete button/);
            expect(result.cleanup.left).toBe(1);
            expect(result.cleanup.stuck.needle).toMatch(/^salesai-demo-run1-/);
        });

        it('only lists writes the page made to its own site, not analytics pings', async () => {
            await freshPage();
            await page.route('**/ping', (route) => route.fulfill({ status: 200, body: '' }));

            const result = await run({ apply: true });

            expect(result.outcome.writeRequests.every((request) => request.includes('app.example'))).toBe(true);
        });

        it('learns what a rejected save looks like, and leaves nothing behind', async () => {
            await freshPage();

            const result = await run({ apply: true, valueProvider: () => `${LEARNING_PREFIX}bad!` });

            expect(result.outcome.status).toBe('rejected');
            expect(result.outcome.errors).toEqual(['Invalid name: no special characters']);
            expect(result.outcome.formStillOpen).toBe(true);
            expect(await stored()).toEqual(['keep-me']);
        });

        // Ownership: if nothing it types is marked as ours, it could not tell its row from existing data.
        it('refuses to submit when no value carries the learning prefix', async () => {
            await freshPage();

            const result = await run({ apply: true, valueProvider: () => 'looks-like-real-data' });

            expect(result.applied).toBe(false);
            expect(result.errors[0]).toMatch(/refusing to submit/);
            expect(await stored()).toEqual(['keep-me']);
        });

        // Real risk found by the first version: it matched its row by substring, so another row whose
        // name merely contained ours could have been picked and deleted.
        it('never deletes a row it did not create, even one whose name contains ours', async () => {
            await freshPage([
                'keep-me',
                `${LEARNING_PREFIX}run1-enter-variable-name-extra`, // ours by prefix, but not the row this run made
                'my-salesai-demo-thing' // contains the prefix but is somebody else's name
            ]);

            const result = await run({ apply: true });

            expect(result.errors).toEqual([]);
            expect(result.outcome.status).toBe('created');
            // The row this run made was found by its whole name; cleanup then removed the leftover
            // that starts with the prefix. Unrelated rows are intact.
            expect(await stored()).toEqual(['keep-me', 'my-salesai-demo-thing']);
        });

        // Real risk on the demo panel: names written with hyphens may be refused. A rejected save is
        // retried once with an identifier-safe name, and what each attempt got is recorded.
        it('retries with an underscore name when the panel rejects hyphens, and still cleans up', async () => {
            await freshPage();

            const result = await run({ apply: true, listUrl: `${ORIGIN}/variables?strict=1` });

            expect(result.errors).toEqual([]);
            expect(result.attempts.map((attempt) => attempt.status)).toEqual(['rejected', 'created']);
            expect(result.attempts[0].errors).toEqual(['Only letters, numbers and underscores']);
            expect(result.attempts[1].needle).toBe('salesai_demo_run1_name'.replace('name', 'enter_variable_name'));
            expect(result.outcome.status).toBe('created');
            expect(result.deleteFlow.steps.at(-1)).toMatchObject({ where: 'confirmation', label: 'Delete' });
            expect(await stored()).toEqual(['keep-me']);
        });

        it('does not retry a save that was not rejected', async () => {
            await freshPage();

            const result = await run({ apply: true });

            expect(result.attempts).toHaveLength(1);
        });

        it('cleans up the row even when the budget runs out before it could delete it itself', async () => {
            await freshPage();

            // goto, find, press, fill x2, press-commit = 6 steps; the delete flow then runs out.
            const result = await run({ apply: true, maxSteps: 6 });

            expect(result.errors.join(' ')).toMatch(/step budget/);
            expect(result.outcome.status).toBe('created');
            expect(result.cleanup).toEqual({ deleted: 1, left: 0 });
            expect(await stored()).toEqual(['keep-me']);
        });
    });

    describe('sweepOwnedRows', () => {
        it('removes rows left behind by an earlier run and nothing else', async () => {
            await freshPage(['keep-me', `${LEARNING_PREFIX}old-one`, `${LEARNING_PREFIX}old-two`, 'another-real-row']);

            const swept = await sweepOwnedRows(page, `${ORIGIN}/variables?mode=inline`, { settle });

            expect(swept).toEqual({ deleted: 2, left: 0 });
            expect(await stored()).toEqual(['keep-me', 'another-real-row']);
        });

        it('also removes leftovers written with the identifier-safe prefix', async () => {
            await freshPage(['keep-me', `${safePrefix(LEARNING_PREFIX)}old1`]);

            const swept = await sweepOwnedRows(page, `${ORIGIN}/variables?mode=inline`, { settle });

            expect(swept).toEqual({ deleted: 1, left: 0 });
            expect(await stored()).toEqual(['keep-me']);
        });

        it('removes leftovers the panel stored with every separator dropped', async () => {
            await freshPage(['keep-me', 'salesaidemoold1name']);
            await open('chip');

            const swept = await sweepOwnedRows(page, `${ORIGIN}/variables?mode=chip`, { settle });

            expect(swept).toEqual({ deleted: 1, left: 0 });
            expect(await stored()).toEqual(['keep-me']);
        });

        it('does nothing when there is nothing of ours', async () => {
            await freshPage();

            const swept = await sweepOwnedRows(page, `${ORIGIN}/variables?mode=inline`, { settle });

            expect(swept).toEqual({ deleted: 0, left: 0 });
        });
    });
});
