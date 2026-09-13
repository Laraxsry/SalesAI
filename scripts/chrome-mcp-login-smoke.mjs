import http from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { ChromeMcpTour } from '../packages/screen/src/chrome-mcp-tour.js';
import { loginProbe } from '../packages/screen/src/chrome-login.js';

let submissions = 0;
let wrongClicks = 0;
const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/wrong') { wrongClicks++; res.end('Wrong button'); return; }
    if (req.url === '/dashboard') { res.end('<h1>Dashboard</h1>'); return; }
    if (req.url.startsWith('/submit')) {
        submissions++;
        res.end('ok');
        return;
    }
    const mode = new URL(req.url, 'http://localhost').searchParams.get('mode');
    res.end(`<!doctype html><html><body>
      <nav><a href="/login">Giriş Yap</a></nav>
      <form hidden><input type="password"><button>Hidden submit</button></form>
      <form id="login">
        <label>E-posta<input name="email" type="email" required></label>
        <label>Şifre<input name="password" type="password" required></label>
        <button type="button" onclick="location.href='/wrong'">Google ile Giriş Yap</button>
        <button type="submit">Giriş Yap</button>
        ${mode === 'ambiguous' ? '<button type="submit">Continue</button>' : ''}
      </form>
      <script>
        document.querySelector('#login').addEventListener('submit', async event => {
          event.preventDefault();
          if (${JSON.stringify(mode)} === 'error') {
            const error = document.createElement('p'); error.role = 'alert'; error.textContent = 'Invalid credentials'; document.body.append(error); return;
          }
          const form = event.target;
          if (form.email.value !== 'demo@example.test' || form.password.value !== 'test-only-password') throw new Error('Incorrect form values');
          await fetch('/submit', { method: 'POST' });
          setTimeout(() => location.href = '/dashboard', 250);
        });
      </script>
    </body></html>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
    for (const mode of ['success', 'ambiguous', 'error', 'invalid']) {
        const tour = new ChromeMcpTour({
            startUrl: base,
            auth: { loginUrl: `${base}/login?mode=${mode}`, email: mode === 'invalid' ? 'invalid-email' : 'demo@example.test', password: 'test-only-password' }
        });
        try {
            if (mode === 'success') {
                await tour.prepare({ loginTargetUrl: base });
                assert.equal(tour.loggedIn, true);
                assert.equal(tour.currentUrl, `${base}/dashboard`);
            } else {
                const error = mode === 'ambiguous' ? /unique username field and submit/ : mode === 'invalid' ? /validation failed/ : /reported an error/;
                await assert.rejects(tour.prepare({ loginTargetUrl: base }), error);
                assert.equal(tour.loggedIn, false);
            }
            console.log(`PASS ${mode}`);
        } finally { await tour.close(); }
    }
    assert.equal(submissions, 1);
    assert.equal(wrongClicks, 0);
    // Read-only regression on the original page; no real credentials or submit.
    if (process.argv.includes('--live')) {
        const tour = new ChromeMcpTour({ startUrl: 'https://gelirgider.co/login' });
        try {
            await tour.open();
            const { snapshot } = await tour.observe();
            const probe = loginProbe(snapshot);
            const { indices, error } = await tour.evaluateLogin(probe.function, probe.uids);
            assert.equal(error, undefined);
            const submitUid = probe.uids[indices[2]];
            const line = snapshot.split('\n').find(line => line.includes(`uid=${submitUid} `));
            assert.match(line, /button "Giriş Yap"/);
            console.log('PASS live GelirGider form submit resolved (no login attempted)');
        } finally { await tour.close(); }
    }
} finally {
    server.close();
    await once(server, 'close');
}
