#!/usr/bin/env node
/**
 * Dry-run crawl: visits a site exactly like ingestion does, then prints what it
 * found. It stops there — no LLM calls, no embeddings, no database writes — so
 * it costs no tokens and changes nothing. Meant for developing and checking the
 * crawler against a real site.
 *
 *   node tools/inspector/crawl-dry-run.mjs <startUrl> [--max-pages 20] [--json out.json]
 *
 * For a logged-in panel pass the demo account through the environment (they are
 * read, never printed or saved):
 *
 *   LOGIN_URL=https://app.example/login LOGIN_USER=... LOGIN_PASS=... \
 *     node tools/inspector/crawl-dry-run.mjs https://app.example/project/1/agent
 *
 * The full result (page text, links, elements) is written to
 * tools/inspector/out/dry-crawl.json, which is git-ignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* env may come from the shell */ }

const argv = process.argv.slice(2);
const startUrl = argv.find((arg) => /^https?:\/\//.test(arg));
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
if (!startUrl) {
    console.error('Usage: node tools/inspector/crawl-dry-run.mjs <startUrl> [--max-pages 20] [--json out.json]');
    process.exit(1);
}

// The crawler reads its limit when it is imported, so set it first.
process.env.URL_CRAWL_MAX_PAGES = option('--max-pages', '20');

const { extractFromUrl } = await import(resolve(ROOT, 'apps/worker-ingestion/src/extractors/url.js'));

const { LOGIN_URL, LOGIN_USER, LOGIN_PASS } = process.env;
const auth = LOGIN_USER && LOGIN_PASS
    ? { loginUrl: LOGIN_URL || undefined, username: LOGIN_USER, password: LOGIN_PASS }
    : null;
console.log(`Crawling ${startUrl} ${auth ? '(logged in)' : '(anonymous)'} — max ${process.env.URL_CRAWL_MAX_PAGES} pages`);
console.log('Dry run: no LLM, no embeddings, nothing is saved to the database.\n');

const startedAt = Date.now();
let result;
try {
    result = await extractFromUrl(startUrl, auth, (done, max) => {
        process.stdout.write(`\r  pages visited: ${done}/${max}   `);
    });
} catch (error) {
    console.error(`\nCrawl failed: ${error.message}`);
    process.exit(1);
}
console.log(`\n\nFinished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

const origin = new URL(startUrl).origin;
const short = (url) => url.replace(origin, '') || '/';
const rows = Object.entries(result.pagesIndex).map(([url, page]) => ({
    page: short(url),
    textChars: (page.rawText || '').length,
    links: (page.links || []).length,
    elements: (page.components?.interactiveElements || []).length,
    tabs: (page.tabVariants || []).length,
    opens: (page.components?.states || []).length,
    foundFrom: page.parentUrl ? short(page.parentUrl) : '(start)'
}));
console.table(rows);

// What pressing each button on a page opened (logged-in crawls only).
for (const [url, page] of Object.entries(result.pagesIndex)) {
    const states = page.components?.states || [];
    if (!states.length) continue;
    console.log(`\n${short(url)} — pressing buttons opened:`);
    for (const state of states) {
        const detail = state.title || state.targetUrl || (state.newElements || []).slice(0, 4).map((e) => e.label).join(', ');
        const writes = state.writeRequests?.length ? `  [WROTE: ${state.writeRequests.join('; ')}]` : '';
        console.log(`  "${state.trigger}" -> ${state.kind}${detail ? `: ${detail}` : ''}${writes}`);
        const fields = state.form?.fields || [];
        if (fields.length) {
            console.log(`      form: ${fields.map((f) => `${f.label || '(no label)'} [${f.type}${f.required ? ', required' : ''}]`).join('; ')}`);
        }
    }
}
console.log('');

const empty = rows.filter((row) => row.textChars < 200);
console.log(`Pages: ${rows.length}   Elements: ${rows.reduce((sum, row) => sum + row.elements, 0)}   Pages with almost no text (<200 chars): ${empty.length}`);
if (empty.length) console.log(`  -> ${empty.map((row) => row.page).join(', ')}`);

const out = resolve(ROOT, option('--json', 'tools/inspector/out/dry-crawl.json'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ startUrl, crawledAt: new Date().toISOString(), pagesIndex: result.pagesIndex }, null, 2));
console.log(`\nFull result written to ${out}`);
