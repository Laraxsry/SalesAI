import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { discoverClientRoutedLinks } from './nav-discovery.js';

// Real-browser check of the page-side collector and the click-and-return loop,
// against a sidebar shaped like a React dashboard (div items, route attribute,
// no hrefs). Skipped where the Chromium binary is not installed.
const hasBrowser = existsSync(chromium.executablePath());

const ORIGIN = 'https://app.example';

// Items navigate with history.pushState, like a client-routed SPA.
const SPA = `<!doctype html><html><body>
<nav style="width:256px">
  <div role="button" tabindex="0" aria-expanded="true" id="build">Build</div>
  <div data-copilot-nav-path="/project/:id/cms/agent" style="cursor:pointer" onclick="go('/cms/agent')">
    <svg width="10" height="10"></svg><div>Playbooks</div>
  </div>
  <div data-copilot-nav-path="/project/:id/cms/flow" onclick="go('/cms/flow')">Workflows</div>
  <div style="cursor:pointer" onclick="go('/analytics')"><span>Analytics</span></div>
  <div>Plain label, not clickable</div>
  <button onclick="go('/billing')">Upgrade</button>
  <button onclick="go('/published')">Publish</button>
  <a href="/real-link">Real link</a>
</nav>
<main><div style="cursor:pointer" onclick="go('/outside')">Outside nav</div></main>
<script>
  function go(path) { history.pushState({}, '', path); }
</script>
</body></html>`;

describe.skipIf(!hasBrowser)('discoverClientRoutedLinks in a real browser', () => {
    let browser;
    let page;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        await context.route('**/*', (route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: SPA })
        );
        page = await context.newPage();
    });

    afterAll(async () => {
        await browser?.close();
    });

    it('finds div menu items through the route attribute and the pointer cursor', async () => {
        await page.goto(`${ORIGIN}/home`);

        const found = await discoverClientRoutedLinks(page, ORIGIN, { settle: async () => {} });

        expect(found).toEqual([
            { label: 'Playbooks', targetUrl: `${ORIGIN}/cms/agent`, kind: 'button' },
            { label: 'Workflows', targetUrl: `${ORIGIN}/cms/flow`, kind: 'button' },
            { label: 'Analytics', targetUrl: `${ORIGIN}/analytics`, kind: 'button' }
        ]);
    });

    it('never clicks section toggles, panel actions, plain text, real links or controls outside navigation', async () => {
        await page.goto(`${ORIGIN}/home`);

        const found = await discoverClientRoutedLinks(page, ORIGIN, { settle: async () => {} });
        const targets = found.map((item) => item.targetUrl);

        for (const forbidden of ['/billing', '/published', '/outside', '/real-link']) {
            expect(targets).not.toContain(`${ORIGIN}${forbidden}`);
        }
        // The collapsible header must still be expanded afterwards.
        await expect(page.getAttribute('#build', 'aria-expanded')).resolves.toBe('true');
        expect(page.url()).toBe(`${ORIGIN}/home`);
    });
});
