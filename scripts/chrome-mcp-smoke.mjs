import http from 'node:http';
import { once } from 'node:events';
import { BrowserSession, ChromeMcpTour } from '@repo/screen';

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Chrome MCP smoke</title></head>
  <body>
    <section role="dialog" aria-label="Cookie preferences" id="cookie-banner">
      <p>We use cookies for this isolated demo.</p>
      <button id="accept-cookies">Accept all</button>
    </section>
    <main>
      <h1>Demo workspace</h1>
      <button id="faq" aria-expanded="false" aria-controls="answer">How does billing work?</button>
      <p id="answer" hidden>Billing is calculated from active seats.</p>
      <form>
        <label for="name">Contact name</label>
        <input id="name" name="name" autocomplete="off">
        <label for="email">Work email</label>
        <input id="email" name="email" type="email" autocomplete="off">
      </form>
      <script>
        document.querySelector('#accept-cookies').addEventListener('click', () => {
          document.querySelector('#cookie-banner').remove();
        });
        document.querySelector('#faq').addEventListener('click', (event) => {
          const open = event.currentTarget.getAttribute('aria-expanded') === 'true';
          event.currentTarget.setAttribute('aria-expanded', String(!open));
          document.querySelector('#answer').hidden = open;
        });
      </script>
    </main>
  </body>
</html>`;

function uidFor(snapshot, pattern) {
    const line = snapshot.split('\n').find((candidate) => pattern.test(candidate));
    return line?.match(/uid=([^\s]+)/)?.[1] ?? null;
}

function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
}

const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url === '/second'
        ? '<!doctype html><html><body><h1>Second demo tab</h1></body></html>'
        : html);
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const startUrl = `http://127.0.0.1:${port}/`;
const browser = new BrowserSession({
    provider: 'chrome-mcp',
    driver: new ChromeMcpTour({ startUrl })
});

try {
    await browser.open(startUrl);
    const initial = await browser.observe();
    const originalPageId = initial.pageId;
    const faqUid = uidFor(initial.snapshot, /button.*How does billing work/i);
    const nameUid = uidFor(initial.snapshot, /textbox.*Contact name/i);
    const emailUid = uidFor(initial.snapshot, /textbox.*Work email/i);
    requireCondition(faqUid && nameUid && emailUid, 'Could not find live FAQ/form UIDs.');
    requireCondition(!initial.snapshot.includes('Accept all'), 'Cookie consent was not dismissed before presentation.');
    const geometry = await browser.describeElement(faqUid);
    requireCondition(geometry.geometry.width > 0 && geometry.geometry.height > 0,
        'Presentation geometry probe returned an empty target.');

    await browser.perform('click', { uid: faqUid, includeSnapshot: true });
    const expanded = await browser.observe();
    requireCondition(expanded.snapshot.includes('Billing is calculated from active seats.'),
        'FAQ click did not expose its answer.');

    await browser.perform('fillForm', {
        elements: [
            { uid: nameUid, value: 'Demo Visitor' },
            { uid: emailUid, value: 'visitor@example.test' }
        ],
        includeSnapshot: true
    });
    const filled = await browser.observe();
    requireCondition(filled.snapshot.includes('Demo Visitor'), 'Name field value was not observed.');
    requireCondition(filled.snapshot.includes('visitor@example.test'), 'Email field value was not observed.');

    await browser.perform('newPage', { url: `${startUrl}second` });
    const second = await browser.observe();
    requireCondition(second.snapshot.includes('Second demo tab'), 'New tab did not show the expected page.');
    const pages = await browser.perform('listPages', {});
    requireCondition(pages.content.includes(startUrl), 'Page list lost the original demo tab.');

    await browser.perform('selectPage', { pageId: originalPageId, bringToFront: true });
    const restored = await browser.observe();
    requireCondition(restored.snapshot.includes('Demo workspace'), 'Could not restore the original tab.');
    const screenshot = await browser.screenshot();
    requireCondition(screenshot.length > 1000, 'Screenshot was unexpectedly small.');

    process.stdout.write(`${JSON.stringify({
        provider: browser.provider,
        cookieDismissed: true,
        geometryResolved: true,
        faqExpanded: true,
        formFilled: true,
        tabRoundTrip: true,
        screenshotBytes: screenshot.length
    })}\n`);
} finally {
    await browser.close().catch(() => {});
    server.close();
    await once(server, 'close');
}
