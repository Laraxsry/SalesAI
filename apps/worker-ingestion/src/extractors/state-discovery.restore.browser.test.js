import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { peekAtButtons } from './state-discovery.js';

// A reload makes the whole app boot again, which is slow on a real panel. The peek should only reload
// when closing the thing it opened by the cheap ways (Escape, a close button) did not bring the page back.
const hasBrowser = existsSync(chromium.executablePath());
const ORIGIN = 'https://app.example';

const page = (body) => `<!doctype html><html><body><main>${body}<div id="layer"></div></main>
<script>
  function layer(html) { document.getElementById('layer').innerHTML = html; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') layer(''); });
</script></body></html>`;

// Closes with Escape.
const TOGGLES = page(`<button onclick="layer('<div class=panel><button>Inside panel</button></div>')">Show panel</button>`);
// Has no way to close it: only a reload brings the page back.
const PERMANENT = page(`<button onclick="document.body.insertAdjacentHTML('beforeend', '<p><button>Added forever</button></p>')">Show hint</button>`);

describe.skipIf(!hasBrowser)('peekAtButtons: reload only when it has to', () => {
    let browser;
    beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
    afterAll(async () => { await browser?.close(); });

    async function peek(html) {
        const context = await browser.newContext();
        let loads = 0;
        await context.route('**/*', (route) => {
            if (route.request().resourceType() === 'document') loads++;
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
        });
        const tab = await context.newPage();
        await tab.goto(`${ORIGIN}/page`);
        const result = await peekAtButtons(tab, `${ORIGIN}/page`, { settle: async () => {} });
        await context.close();
        return { result, loads };
    }

    it('does not reload when Escape brings the page back', async () => {
        const { result, loads } = await peek(TOGGLES);

        expect(result.states.map((state) => state.trigger)).toEqual(['Show panel']);
        expect(loads).toBe(1); // only the first load
    });

    it('reloads when what it opened cannot be closed', async () => {
        const { result, loads } = await peek(PERMANENT);

        expect(result.states.map((state) => state.trigger)).toEqual(['Show hint']);
        expect(loads).toBe(2); // the first load, and one reload
    });
});
