const DEFAULT_TIMEOUT_MS = Number(process.env.LOGIN_FORM_TIMEOUT_MS || 12_000);

const USERNAME_SELECTORS = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[name="email" i]',
    'input[id="email" i]',
    'input[name="username" i]',
    'input[id="username" i]',
    'input[name="login" i]',
    'input[id="login" i]',
    'input[name="user" i]',
    'input[id="user" i]'
];
const PASSWORD_SELECTORS = ['input[type="password"]', 'input[autocomplete="current-password"]'];
const NEXT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Devam")',
    'button:has-text("İleri")'
];
const SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Giriş Yap")',
    'button:has-text("Giriş")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")'
];
const LOGIN_LINK_SELECTORS = [
    'a:has-text("Log in")',
    'a:has-text("Login")',
    'a:has-text("Sign in")',
    'a:has-text("Giriş Yap")',
    'button:has-text("Log in")',
    'button:has-text("Sign in")'
];
const REGISTER_ROUTE = /\/(?:sign-?up|register|create-account)(?:\/|$)/i;

function authRouteKey(value) {
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}`;
    } catch {
        return value;
    }
}

function scopesFor(page) {
    const frames = typeof page.frames === 'function' ? page.frames() : [];
    return frames.length ? frames : [page];
}

async function visible(locator) {
    return (await locator.count().catch(() => 0)) > 0 && await locator.isVisible().catch(() => false);
}

async function findVisible(page, selectors, timeout = DEFAULT_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
        for (const scope of scopesFor(page)) {
            for (const selector of selectors) {
                const locator = scope.locator(selector).first();
                if (await visible(locator)) return locator;
            }
        }
        await page.waitForTimeout(200);
    }
    return null;
}

async function locateField(page, override, candidates, label, timeout = DEFAULT_TIMEOUT_MS) {
    if (!override) return findVisible(page, candidates, timeout);
    const field = await findVisible(page, [override], timeout);
    if (!field) throw new Error(`[GuidedTour] Configured ${label} selector matched no visible element: ${override}`);
    return field;
}

const STATIC_ASSET = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map)$/i;
const TRACE_LIMIT = 60;

function baseDomain(hostname) {
    return hostname.split('.').slice(-2).join('.');
}

/**
 * Records what the browser saw during a login attempt (navigations, the site's
 * own non-GET/failed requests, console errors, our own steps) so a failure can
 * be diagnosed from the terminal. Never records request bodies or query
 * strings, so credentials cannot leak into logs. `LOGIN_DEBUG=1` also prints
 * every event live.
 */
function createLoginTrace(page, targetUrl) {
    const events = [];
    const startedAt = Date.now();
    const live = process.env.LOGIN_DEBUG === '1';
    const note = (message) => {
        const line = `+${String(Date.now() - startedAt).padStart(5)}ms ${message}`;
        events.push(line);
        if (events.length > TRACE_LIMIT) events.shift();
        if (live) console.log(`[login-trace] ${line}`);
    };

    let siteDomain = '';
    try { siteDomain = baseDomain(new URL(targetUrl).hostname); } catch { /* no target host */ }
    const isSiteHost = (value) => {
        try { return Boolean(siteDomain) && baseDomain(new URL(value).hostname) === siteDomain; } catch { return false; }
    };
    const pathOf = (value) => {
        try { const url = new URL(value); return `${url.host}${url.pathname}`; } catch { return value; }
    };

    if (typeof page.on === 'function') {
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame?.()) note(`navigated -> ${authRouteKey(frame.url())}`);
        });
        page.on('response', (response) => {
            const request = response.request();
            const url = request.url();
            if (!isSiteHost(url) || STATIC_ASSET.test(new URL(url).pathname)) return;
            if (request.method() === 'GET' && response.status() < 400) return;
            note(`${request.method()} ${response.status()} ${pathOf(url)}`);
        });
        page.on('requestfailed', (request) => {
            if (isSiteHost(request.url())) note(`request failed ${pathOf(request.url())}: ${request.failure()?.errorText || 'unknown'}`);
        });
        page.on('console', (message) => {
            if (message.type() === 'error') note(`console.error ${message.text().slice(0, 160)}`);
        });
    }

    return { note, dump: () => events.slice() };
}

async function describeLoginPage(page) {
    const inputs = await page.locator('input').evaluateAll((elements) => elements
        .filter((element) => element.offsetWidth || element.offsetHeight || element.getClientRects().length)
        .map((element) => element.type || 'text')
        .slice(0, 8)).catch(() => []);
    let title = '';
    try { title = (await page.title()).slice(0, 80); } catch { /* page without a title */ }
    return `url=${page.url()}, title=${JSON.stringify(title)}, visibleInputs=${inputs.join(',') || 'none'}`;
}

async function leaveRegistrationPage(page) {
    let pathname = '';
    try { pathname = new URL(page.url()).pathname; } catch { return; }
    if (!REGISTER_ROUTE.test(pathname)) return;

    const loginLink = await findVisible(page, LOGIN_LINK_SELECTORS, 3000);
    if (!loginLink) {
        throw new Error(`[GuidedTour] Login URL opened a registration page and no login link was found: ${page.url()}`);
    }
    await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => {}),
        loginLink.click()
    ]);
}

async function dismissCookieBanner(page) {
    const button = await findVisible(page, [
        'button:has-text("Kabul Et")',
        'button:has-text("Accept all")',
        'button:has-text("Accept")'
    ], 500);
    if (!button) return;
    await button.click({ timeout: 1500 }).catch(() => {});
}

/**
 * Generic credential-form authentication. It owns login discovery and state
 * transitions; callers own the browser lifecycle and subsequent crawling.
 * Supports same-page and username-first forms, iframe-hosted forms, explicit
 * selector overrides, and registration-page redirects.
 */
export async function loginWithCredentials(page, auth, fallbackUrl) {
    const trace = createLoginTrace(page, auth?.loginUrl || fallbackUrl || '');
    try {
        await runLogin(page, auth, fallbackUrl, trace);
        trace.note(`login ok, url=${authRouteKey(page.url())}`);
    } catch (error) {
        console.error(`[login-trace] login failed: ${error.message}\n${trace.dump().map((line) => `  ${line}`).join('\n')}`);
        throw error;
    }
}

async function runLogin(page, auth, fallbackUrl, trace) {
    const { loginUrl, password, selectors = {} } = auth || {};
    const username = auth?.username || auth?.email;
    const target = loginUrl || fallbackUrl;
    if (!username || !password) throw new Error('[GuidedTour] demoSession is missing username/email or password.');
    if (!target) throw new Error('[GuidedTour] demoSession has no loginUrl and no fallback URL to log in at.');

    trace.note(`goto ${authRouteKey(target)}`);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    trace.note(`loaded ${authRouteKey(page.url())}`);
    await leaveRegistrationPage(page);
    await dismissCookieBanner(page);

    const usernameField = await locateField(
        page,
        selectors.username || selectors.email,
        USERNAME_SELECTORS,
        'username'
    );
    if (!usernameField) {
        throw new Error(`[GuidedTour] Could not locate a username/email field (${await describeLoginPage(page)}).`);
    }
    trace.note(`filling username on ${authRouteKey(page.url())}`);
    await usernameField.fill(username);

    let passwordField = await locateField(page, selectors.password, PASSWORD_SELECTORS, 'password', 1200);
    if (!passwordField) {
        const nextButton = await locateField(page, selectors.next, NEXT_SELECTORS, 'next', 2500);
        if (!nextButton) {
            throw new Error(`[GuidedTour] Username field was found, but the password field or next button was not (${await describeLoginPage(page)}).`);
        }
        await nextButton.click();
        passwordField = await locateField(page, selectors.password, PASSWORD_SELECTORS, 'password');
    }
    if (!passwordField) {
        throw new Error(`[GuidedTour] Could not locate a password field (${await describeLoginPage(page)}).`);
    }
    trace.note(`filling password on ${authRouteKey(page.url())}`);
    await passwordField.fill(password);

    const loginPage = authRouteKey(page.url());
    const submitButton = await locateField(page, selectors.submit, SUBMIT_SELECTORS, 'submit', 2500);
    trace.note(`submitting (${submitButton ? 'button' : 'Enter'}) on ${loginPage}`);
    if (submitButton) await submitButton.click();
    else await passwordField.press('Enter');

    const errorLocator = page.locator(
        '[role="alert"], #Label_HATA, .text-danger, .validation-summary-errors, [data-error]'
    ).first();
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    while (true) {
        // Checked on every pass, including the last one: a slow poll (or slow
        // page) must not let the deadline pass without re-reading the result.
        const routeChanged = authRouteKey(page.url()) !== loginPage;
        const passwordStillVisible = await visible(passwordField);
        if (routeChanged || !passwordStillVisible) {
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            return;
        }

        // textContent() auto-waits ~30s for an element that does not exist,
        // so only read it once an error element is actually visible.
        if (await visible(errorLocator)) {
            const errorText = await errorLocator.textContent({ timeout: 1000 }).catch(() => '');
            if (errorText?.trim()) throw new Error(`[GuidedTour] Login failed: ${errorText.trim()}`);
        }

        if (Date.now() >= deadline) break;
        await page.waitForTimeout(250);
    }

    throw new Error(`[GuidedTour] Login did not complete (${await describeLoginPage(page)}).`);
}
