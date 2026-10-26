import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// End to end through extractFromUrl in a real browser, against a small fake
// dashboard (div menu, SPA routing, a button that opens a dialog). Only the
// network edge is faked: DNS check, login, and the host the browser reaches.
vi.mock('@repo/utils', async (importOriginal) => ({
    ...(await importOriginal()),
    checkSSRFUrl: vi.fn().mockResolvedValue(undefined),
    safeFetch: vi.fn()
}));
vi.mock('@repo/screen', () => ({ loginWithCredentials: vi.fn() }));
vi.mock('@repo/rag', () => ({ extractDocumentText: vi.fn() }));

const LONG = 'This workspace page explains in some detail what you can do here and how the screen is organised. '.repeat(4);
const SPA = `<!doctype html><html><body>
<nav>
  <div data-nav-path="/project/1/flows" onclick="go('/project/1/flows')">Workflows</div>
</nav>
<main>
  <h1 id="title">Home</h1>
  <p>${LONG}</p>
  <button data-testid="open-thing" onclick="document.getElementById('layer').innerHTML = '<div role=dialog aria-modal=true><h2>New thing</h2><button onclick=&quot;document.getElementById(\\'layer\\').innerHTML=\\'\\'&quot;>Cancel</button></div>'">Open thing</button>
  <div id="layer"></div>
</main>
<script>
  function go(path) { history.pushState({}, '', path); document.getElementById('title').textContent = path.endsWith('flows') ? 'Workflows' : 'Home'; }
  addEventListener('popstate', () => { document.getElementById('title').textContent = location.pathname.endsWith('flows') ? 'Workflows' : 'Home'; });
</script>
</body></html>`;

// Real Chromium, but every request lands on the fake dashboard instead of the network.
vi.mock('playwright', async () => {
    const actual = await vi.importActual('playwright');
    return {
        chromium: {
            launch: async (...args) => {
                const browser = await actual.chromium.launch(...args);
                const newContext = browser.newContext.bind(browser);
                browser.newContext = async (...options) => {
                    const context = await newContext(...options);
                    await context.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: SPA }));
                    return context;
                };
                return browser;
            }
        }
    };
});

process.env.URL_CRAWL_SLOW_PAGE_WAIT_MS = '0';
process.env.URL_CRAWL_MAX_PAGES = '5';

const { extractFromUrl } = await import('./url.js');
// The mocked 'playwright' above hides executablePath; ask the real module.
const realPlaywright = await vi.importActual('playwright');
const hasBrowser = existsSync(realPlaywright.chromium.executablePath());

// A crawl does several real waits per page and reloads for tab discovery.
const CRAWL_TIMEOUT_MS = 90_000;

const ORIGIN = 'https://app.example';
const START = `${ORIGIN}/project/1/home`;

describe.skipIf(!hasBrowser)('extractFromUrl on a dashboard, in a real browser', () => {
    it('logged in: follows the div menu to its pages and records what the page buttons open', async () => {
        const result = await extractFromUrl(START, { username: 'demo@example.com', password: 'secret' });

        const urls = Object.keys(result.pagesIndex);
        expect(urls).toContain(`${ORIGIN}/project/1/flows`);

        const home = result.pagesIndex[START];
        expect(home.components.states).toEqual([
            expect.objectContaining({ trigger: 'Open thing', kind: 'dialog', title: 'New thing' })
        ]);

        // The button record says how to find it again by more than a selector, and what pressing it does.
        const button = home.components.interactiveElements.find((element) => element.label === 'Open thing');
        expect(button.locators).toEqual(expect.arrayContaining([
            { by: 'attr', name: 'data-testid', value: 'open-thing' },
            { by: 'role', role: 'button', value: 'Open thing' },
            { by: 'text', value: 'Open thing' },
            expect.objectContaining({ by: 'css' })
        ]));
        expect(button.locators[0]).toEqual({ by: 'attr', name: 'data-testid', value: 'open-thing' }); // most durable first
        expect(button.expected).toBe('Opens a dialog "New thing" with: Cancel.');
        // The key every consumer already uses is still there.
        expect(button.elementKey).toMatch(/^el_/);
    }, CRAWL_TIMEOUT_MS);

    it('anonymous (a public site): same menu discovery, but no button presses', async () => {
        const result = await extractFromUrl(START);

        expect(Object.keys(result.pagesIndex)).toContain(`${ORIGIN}/project/1/flows`);
        expect(result.pagesIndex[START].components.states).toBeUndefined();
    }, CRAWL_TIMEOUT_MS);
});
