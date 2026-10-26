#!/usr/bin/env node
/**
 * Learn one "create" flow on a logged-in demo account: open the form behind a button, read its
 * fields, and (only with --apply) fill it with recognisable demo values, save, record what the page
 * says, delete the row it made, and sweep up anything of ours left over.
 *
 *   node tools/inspector/learn-form.mjs --page <listUrl> --trigger "New variable"            (reads only)
 *   node tools/inspector/learn-form.mjs --page <listUrl> --trigger "New variable" --apply    (creates + deletes one row)
 *
 * Options: --headed (watch the browser)  --max-steps 40  --max-seconds 120  --json out.json
 *          --no-screenshots (by default a screenshot is saved at each step that matters)
 *
 * Keep what was learned (needs the database and the embedding key from .env; costs a few embeddings):
 *   --save --product <productId> --source <panelSourceId> [--language tr|en] [--describe]
 * Only a flow that was created AND deleted again is saved, as a recipe the agent can find and follow.
 * --describe also asks the language model for a "what is this for" line (one short call).
 *
 * The account comes from the environment (read, never printed or saved):
 *   LOGIN_URL=https://app.example/login LOGIN_USER=... LOGIN_PASS=...
 *
 * Everything it creates carries the prefix `salesai-demo-` and a run id. It only ever deletes a row
 * whose name is exactly the one it typed, and it refuses to submit when nothing it types is marked
 * as its own. Without --apply nothing is written at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* env may come from the shell */ }

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const flag = (name) => argv.includes(name);

const listUrl = option('--page');
const trigger = option('--trigger');
if (!listUrl || !trigger) {
    console.error('Usage: node tools/inspector/learn-form.mjs --page <listUrl> --trigger "<button label>" [--apply] [--headed]');
    process.exit(1);
}
const apply = flag('--apply');

const { chromium } = await import(resolve(ROOT, 'node_modules/playwright/index.mjs'));
const { loginWithCredentials } = await import(resolve(ROOT, 'packages/screen/src/credential-login.js'));
const { learnCreateFlow } = await import(resolve(ROOT, 'apps/worker-ingestion/src/extractors/learning-run.js'));
// The crawler's own patient wait for a page that renders slowly.
process.env.URL_CRAWL_SLOW_PAGE_WAIT_MS ??= '20000';
const { waitForInitialRender, waitForStableContent } = await import(resolve(ROOT, 'apps/worker-ingestion/src/extractors/url.js'));

const { LOGIN_URL, LOGIN_USER, LOGIN_PASS } = process.env;
console.log(`${apply ? 'APPLY — will create, then delete, one row on the account' : 'DRY — reads the form only, writes nothing'}`);
console.log(`page: ${listUrl}\ntrigger: "${trigger}"\n`);

const slug = trigger.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const shotDir = resolve(ROOT, 'tools/inspector/out');
const shots = [];
const onSnapshot = flag('--no-screenshots')
    ? null
    : async (label, page) => {
        mkdirSync(shotDir, { recursive: true });
        const file = resolve(shotDir, `learn-${slug}-${shots.length + 1}-${label}.png`);
        await page.screenshot({ path: file }).catch(() => {});
        shots.push(file);
    };

const browser = await chromium.launch({ headless: !flag('--headed') });
let result;
try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    if (LOGIN_USER && LOGIN_PASS) {
        await loginWithCredentials(page, { loginUrl: LOGIN_URL || undefined, username: LOGIN_USER, password: LOGIN_PASS }, listUrl);
    }
    result = await learnCreateFlow(page, {
        listUrl,
        trigger,
        settle: waitForInitialRender, // a page load: wait patiently for it to draw
        settleAction: waitForStableContent, // after a press: the page is already drawn
        apply,
        maxSteps: Number(option('--max-steps', 40)),
        maxMs: Number(option('--max-seconds', 120)) * 1000,
        onSnapshot
    });
} finally {
    await browser.close();
}

const line = (label, value) => console.log(`${label.padEnd(14)}${value}`);
if (result.form) {
    console.log('form fields:');
    for (const field of result.form.fields) {
        console.log(`  - ${field.label || '(no label)'} [${field.type}${field.required ? ', required' : ''}]${field.options ? ` options: ${field.options.join(' | ')}` : ''}`);
    }
    line('buttons:', result.form.actions.map((action) => action.label).join(' | '));
}
if (result.plan) {
    console.log('would type:');
    for (const step of result.plan) console.log(`  - ${step.label || '(no label)'} = ${typeof step.value === 'string' ? `"${step.value}"` : step.value}`);
}
if (result.commit) line('saves with:', `"${result.commit.label}"`);
if (result.outcome) {
    line('result:', result.outcome.status);
    if (result.outcome.notices.length) line('page said:', result.outcome.notices.join(' | '));
    if (result.outcome.errors.length) line('errors:', result.outcome.errors.join(' | '));
    if (result.outcome.writeRequests.length) line('requests:', result.outcome.writeRequests.join('; '));
    if (result.outcome.appeared?.length) line('appeared:', result.outcome.appeared.join(' | '));
    if (result.outcome.surfaces?.length) line('opened:', result.outcome.surfaces.join(' | '));
}
for (const [number, attempt] of (result.attempts || []).entries()) {
    line(`attempt ${number + 1}:`, `${attempt.status} — "${attempt.needle}"${attempt.errors.length ? ` — ${attempt.errors.join(' | ')}` : ''}`);
}
if (result.deleteFlow) {
    line('delete flow:', result.deleteFlow.steps.map((step) => `${step.where}: "${step.label}"`).join('  ->  '));
    if (result.deleteFlow.confirmation) line('confirmation:', `${result.deleteFlow.confirmation.title} ${result.deleteFlow.confirmation.text}`.slice(0, 200));
}
if (result.cleanup) line('cleanup:', `${result.cleanup.deleted} leftover row(s) removed, ${result.cleanup.left} could not be removed`);
const why = result.deleteTrace?.reason ? result.deleteTrace : result.cleanup?.stuck;
if (why) {
    console.log('\nwhy the row could not be deleted:');
    line('  reason:', why.reason || '(unknown)');
    if (why.controls) line('  row controls:', why.controls.join(' | ') || '(none)');
    if (why.menuItems) line('  menu items:', why.menuItems.join(' | '));
    if (why.html) line('  row html:', why.html.replace(/\s+/g, ' ').slice(0, 600));
}
if (result.errors.length) {
    console.log('\nproblems:');
    for (const error of result.errors) console.log(`  - ${error}`);
}
if (result.diagnostics) {
    console.log('\nwhat the page did instead:');
    line('  url:', `${result.diagnostics.url}${result.diagnostics.urlChanged ? '  (changed)' : ''}`);
    line('  surfaces:', result.diagnostics.openSurfaces.join(' | ') || '(none opened)');
    line('  new controls:', result.diagnostics.newControls.join(' | ') || '(none)');
}
console.log(`\n${result.stepCount} steps in ${(result.durationMs / 1000).toFixed(1)}s`);
if (shots.length) console.log(`screenshots: ${shots.length} saved in ${shotDir}`);
if (result.cleanup?.left) console.log('\nWARNING: a row carrying the prefix "salesai-demo-" may still be on the account. Delete it by hand.');

if (flag('--save')) {
    const productId = option('--product');
    const sourceId = option('--source');
    if (!productId || !sourceId) {
        console.error('\n--save needs --product <productId> and --source <panelSourceId>.');
    } else {
        const { buildProcedure } = await import(resolve(ROOT, 'packages/rag/src/procedure.js'));
        const built = buildProcedure(result, { language: option('--language', 'en') });
        if (!built.ok) {
            console.log(`\nNot saved: ${built.reason}.`);
        } else {
            const { connectDB, disconnectDB } = await import('@repo/database');
            const { saveProcedure } = await import(resolve(ROOT, 'packages/rag/src/procedure-store.js'));
            const { describeProcedure } = await import('@repo/ai');
            await connectDB();
            try {
                const saved = await saveProcedure({ procedure: built.procedure, productId, sourceId, describe: flag('--describe') ? describeProcedure : null });
                console.log(`\nSaved procedure "${built.procedure.slug}" (${saved.procedureId}): ${saved.chunks} chunk(s) on the dashboard shelf, description by ${saved.descriptionSource}.`);
            } finally {
                await disconnectDB();
            }
        }
    }
}

const out = resolve(ROOT, option('--json', `tools/inspector/out/learn-${trigger.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`Full result written to ${out}`);
// Saving to the database leaves connections open (cache, queue); the work is done, so end the process.
process.exit(result.errors.length ? 1 : 0);
