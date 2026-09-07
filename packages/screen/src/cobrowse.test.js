import { describe, it, expect, vi } from 'vitest';
import {
    trustKey,
    assertHttpUrl,
    authRouteKey,
    injectSessionSnapshot,
    waitForPageReady,
    GuidedTour
} from './cobrowse.js';
import { isTourNavigableUrl } from '@repo/contracts';

/**
 * trustKey/assertHttpUrl are the pure core of the guided tour's SSRF guard.
 * These tests lock in their behaviour so a future refactor can't silently
 * loosen the trust boundary (which is exactly how it got regressed once).
 */
describe('trustKey', () => {
    it('collapses subdomains of the same product to one key (eTLD+1)', () => {
        expect(trustKey('https://app.example.com')).toBe(trustKey('https://admin.example.com'));
        expect(trustKey('https://www.example.com/pricing')).toBe('example.com');
    });

    it('treats different registrable domains as different keys', () => {
        expect(trustKey('https://salesai.example')).not.toBe(trustKey('https://untrusted.example'));
    });

    it('keeps different ports on a bare host separate (full-origin fallback)', () => {
        // No public suffix -> falls back to protocol+host+port, so a trusted
        // localhost:5432 must NOT also trust localhost:6379.
        expect(trustKey('http://localhost:5432')).not.toBe(trustKey('http://localhost:6379'));
        expect(trustKey('http://127.0.0.1:5432')).not.toBe(trustKey('http://127.0.0.1:6379'));
    });

    it('returns null for an unparseable URL', () => {
        expect(trustKey('not a url')).toBeNull();
        expect(trustKey('')).toBeNull();
    });
});

/**
 * @repo/contracts' isTourNavigableUrl is the editor-side check the playbook
 * feature runs as a marketer types a URL — it must agree with this module's
 * own trustKey, or a step that the editor accepts would fail here mid-call
 * (or worse, the editor would reject a step the runtime would have allowed).
 * Both are eTLD+1-based via tldts; this pins that agreement down directly
 * rather than trusting two independent implementations to stay in sync.
 */
describe('isTourNavigableUrl agrees with trustKey', () => {
    const product = { websiteUrl: 'https://www.cyberverse.example', tourAllowedDomains: ['partner.example'] };
    const trustedKeys = new Set([trustKey(product.websiteUrl), trustKey('https://partner.example')]);

    it.each([
        ['same domain as websiteUrl', 'https://www.cyberverse.example/landing'],
        ['a subdomain sharing the registrable domain', 'https://demo.cyberverse.example/reports'],
        ['a domain only in tourAllowedDomains', 'https://partner.example/demo'],
        ['an unrelated domain', 'https://untrusted.example/'],
        ['a private IP', 'http://127.0.0.1/']
    ])('%s: isTourNavigableUrl matches trustKey membership', (_label, url) => {
        expect(isTourNavigableUrl(url, product)).toBe(trustedKeys.has(trustKey(url)));
    });
});

describe('assertHttpUrl', () => {
    it('accepts http and https', () => {
        expect(() => assertHttpUrl('http://salesai.example')).not.toThrow();
        expect(() => assertHttpUrl('https://salesai.example')).not.toThrow();
    });

    it('rejects non-http(s) schemes', () => {
        expect(() => assertHttpUrl('file:///etc/passwd')).toThrow(/Unsupported URL scheme/);
        expect(() => assertHttpUrl('ftp://host/x')).toThrow(/Unsupported URL scheme/);
    });

    it('rejects a string that is not a URL at all', () => {
        expect(() => assertHttpUrl('not a url')).toThrow(/Invalid URL/);
    });
});

describe('authRouteKey', () => {
    it('treats a canonical trailing slash as the same login route', () => {
        expect(authRouteKey('https://example.com/login')).toBe(authRouteKey('https://example.com/login/'));
    });

    it('still detects navigation away from the login route', () => {
        expect(authRouteKey('https://example.com/login')).not.toBe(authRouteKey('https://example.com/dashboard'));
    });
});

/**
 * Fake Playwright `page` — just enough surface for goto/highlight/click.
 * `url` is mutable so a test can simulate the site redirecting after
 * navigation/click (the open-redirect scenario assertCurrentPageTrusted
 * guards against).
 */
function makeFakePage(startingUrl) {
    let currentUrl = startingUrl;
    return {
        url: vi.fn(() => currentUrl),
        goto: vi.fn(async (target) => {
            currentUrl = target;
        }),
        click: vi.fn(async () => {}),
        waitForTimeout: vi.fn(async () => {}),
        // Constant length ⇒ waitForStableContent() (goto()/click()) sees two
        // consecutive equal reads and resolves immediately — tests that care
        // about the adaptive-wait behavior itself override this per-test.
        waitForFunction: vi.fn(async () => {}),
        evaluate: vi.fn(async () => 42),
        /** Overwritten per-test with a specific locator fake. */
        locator: vi.fn(),
        /** Lets a test move `page.url()` without going through goto() (simulating a redirect). */
        _setUrl(url) {
            currentUrl = url;
        }
    };
}

function makeFakeLocator({ waitForError = null, element = {} } = {}) {
    return {
        first: vi.fn(function () { return this; }),
        waitFor: vi.fn(async () => {
            if (waitForError) throw waitForError;
        }),
        evaluate: vi.fn(async (fn) => fn(element))
    };
}

function makeFakeElement({ tagName = 'DIV', type = null, expanded = null, controlsId = null, visibleText = '' } = {}) {
    const attributes = new Map();
    if (type !== null) attributes.set('type', type);
    if (expanded !== null) attributes.set('aria-expanded', String(expanded));
    if (controlsId !== null) attributes.set('aria-controls', controlsId);
    return {
        tagName,
        getAttribute: (name) => attributes.get(name) ?? null,
        ownerDocument: { getElementById: () => ({ innerText: visibleText }) },
        parentElement: { innerText: visibleText },
        closest: () => null,
        style: {},
        scrollIntoView: vi.fn(),
        _setAttribute: (name, value) => attributes.set(name, String(value))
    };
}

/** A GuidedTour that trusts salesai.example, with its browser bits swapped for fakes. */
function makeTour(page) {
    const tour = new GuidedTour({
        startUrl: 'https://salesai.example/dashboard',
        waitForReady: vi.fn(async () => ({ ready: true, waitMs: 0 }))
    });
    tour.page = page;
    return tour;
}

describe('injectSessionSnapshot', () => {
    it('seeds cookies and origin-scoped localStorage without a setup navigation', async () => {
        const context = {
            addCookies: vi.fn(async () => {}),
            addInitScript: vi.fn(async () => ({ dispose: vi.fn(async () => {}) }))
        };
        const cookies = [{ name: 'session', value: 'x', domain: 'salesai.example', path: '/' }];
        const localStorage = { token: 'secret' };

        const initializer = await injectSessionSnapshot(
            context,
            'https://salesai.example/dashboard',
            { cookies, localStorage }
        );

        expect(context.addCookies).toHaveBeenCalledWith(cookies);
        expect(context.addInitScript).toHaveBeenCalledWith(
            expect.any(Function),
            { allowedOrigin: 'https://salesai.example', storage: localStorage }
        );
        expect(initializer.origin).toBe('https://salesai.example');
    });
});

describe('waitForPageReady', () => {
    it('returns immediately after useful DOM content and two paint frames are available', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');

        const result = await waitForPageReady(page, { timeoutMs: 50 });

        expect(result.ready).toBe(true);
        expect(page.waitForFunction).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('degrades to the loaded page when readiness times out instead of failing navigation', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        page.waitForFunction.mockRejectedValueOnce(new Error('not ready'));

        await expect(waitForPageReady(page, { timeoutMs: 10 })).resolves.toMatchObject({ ready: false });
    });
});

describe('GuidedTour#requiresDemoLogin', () => {
    it('requires login when the first destination is the demo login domain', () => {
        const tour = new GuidedTour({
            startUrl: 'https://www.cyberverse.example',
            auth: { loginUrl: 'https://demo.cyberverse.example/login', username: 'demo', password: 'x' }
        });
        expect(tour.requiresDemoLogin('https://demo.cyberverse.example/dashboard')).toBe(true);
    });

    it('skips login when the first destination is the public site, not the demo domain', () => {
        const tour = new GuidedTour({
            startUrl: 'https://www.cyberverse.example',
            auth: { loginUrl: 'https://demo.cyberverse.example/login', username: 'demo', password: 'x' }
        });
        expect(tour.requiresDemoLogin('https://www.cyberverse.example/?p=solutions')).toBe(false);
    });

    it('falls back to startUrl for both sides when no explicit loginUrl/targetUrl is given', () => {
        // Matches loginWithCredentials' own fallback (auth.loginUrl || fallbackUrl):
        // a demoSession without a separate loginUrl logs in at startUrl itself,
        // so an open() with no known first destination yet must still gate in.
        const tour = new GuidedTour({
            startUrl: 'https://demo.cyberverse.example',
            auth: { username: 'demo', password: 'x' }
        });
        expect(tour.requiresDemoLogin()).toBe(true);
    });
});

describe('GuidedTour#goto', () => {
    it('resolves an in-app relative path against the current page before navigating', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        await tour.goto('/pricing');

        expect(page.goto).toHaveBeenCalledWith('https://salesai.example/pricing', { waitUntil: 'domcontentloaded' });
    });

    it('runs exactly one readiness policy instead of stacking multiple waits or a fixed delay', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        await tour.goto('/pricing');

        expect(tour.waitForReady).toHaveBeenCalledTimes(1);
        expect(tour.waitForReady).toHaveBeenCalledWith(page);
        expect(page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('navigates directly to an already-absolute trusted URL', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        await tour.goto('https://salesai.example/settings');

        expect(page.goto).toHaveBeenCalledWith('https://salesai.example/settings', { waitUntil: 'domcontentloaded' });
        expect(page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('removes transient-auth initialization after the first matching-origin navigation', async () => {
        const page = makeFakePage('about:blank');
        const tour = makeTour(page);
        const dispose = vi.fn(async () => {});
        tour.snapshotInitScript = { origin: 'https://salesai.example', dispose };

        await tour.goto('https://salesai.example/dashboard');

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(tour.snapshotInitScript).toBeNull();
    });

    it('keeps transient-auth initialization until its configured origin is reached', async () => {
        const page = makeFakePage('about:blank');
        const tour = new GuidedTour({
            startUrl: 'https://salesai.example/dashboard',
            allowedDomains: ['https://product-demo.example'],
            waitForReady: vi.fn(async () => ({ ready: true, waitMs: 0 }))
        });
        tour.page = page;
        const dispose = vi.fn(async () => {});
        tour.snapshotInitScript = { origin: 'https://salesai.example', dispose };

        await tour.goto('https://product-demo.example/home');

        expect(dispose).not.toHaveBeenCalled();
        expect(tour.snapshotInitScript).not.toBeNull();
    });

    it('rejects an absolute URL outside the trusted domain(s) without navigating', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        await expect(tour.goto('https://untrusted.example/steal')).rejects.toThrow(
            /Navigation outside the product's domain is not allowed/
        );
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects a relative path that resolves outside the trusted domain (e.g. protocol-relative escape)', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        // Resolved against the current page, "//untrusted.example/x" becomes
        // an absolute URL on a different host entirely.
        await expect(tour.goto('//untrusted.example/x')).rejects.toThrow(
            /Navigation outside the product's domain is not allowed/
        );
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws if the site redirects to an untrusted domain after navigating (open-redirect abuse)', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        // Simulate the target page's own JS redirecting elsewhere right after load.
        page.goto = vi.fn(async () => page._setUrl('https://untrusted.example/redirected'));
        const tour = makeTour(page);

        await expect(tour.goto('/pricing')).rejects.toThrow(/landed outside the trusted domain/);
        // Never execute page-side readiness code after an untrusted redirect.
        expect(tour.waitForReady).not.toHaveBeenCalled();
    });
});

describe('GuidedTour#open', () => {
    it('loads the requested first destination exactly once without an intermediate startUrl navigation', async () => {
        const tour = new GuidedTour({ startUrl: 'https://salesai.example' });
        tour.prepare = vi.fn(async () => tour);
        tour.goto = vi.fn(async () => ({ ready: true, waitMs: 0 }));

        await tour.open('https://salesai.example/solutions');

        expect(tour.prepare).toHaveBeenCalledWith({ loginTargetUrl: 'https://salesai.example/solutions' });
        expect(tour.goto).toHaveBeenCalledTimes(1);
        expect(tour.goto).toHaveBeenCalledWith('https://salesai.example/solutions');
    });

    it('reuses a prepared browser instead of treating prewarm as an already-open tour', async () => {
        const page = makeFakePage('about:blank');
        const tour = makeTour(page);
        tour.browser = { close: vi.fn(async () => {}) };
        const ensureSpy = vi.spyOn(tour, 'ensureBrowserReady');

        await tour.open('https://salesai.example/dashboard');

        expect(ensureSpy).toHaveBeenCalled();
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(tour.opened).toBe(true);
    });
});

/**
 * `open()` only ever checks demoSession login against the tour's FIRST
 * destination (see requiresDemoLogin's own docs) — a playbook that opens on
 * the public site and reaches the demo domain several nodes later (this
 * project's own reference scenario, agent_flow.md) never logged in at all
 * before this: goto() had no equivalent check, so the visitor landed on a
 * bare login screen instead of the actual dashboard.
 */
describe('GuidedTour#goto — on-demand demoSession login', () => {
    function makeAuthedTour(page) {
        const tour = new GuidedTour({
            startUrl: 'https://www.cyberverse.example',
            allowedDomains: ['https://demo.cyberverse.example'],
            auth: { loginUrl: 'https://demo.cyberverse.example/login', username: 'demo', password: 'x' },
            waitForReady: vi.fn(async () => ({ ready: true, waitMs: 0 }))
        });
        tour.page = page;
        tour.login = vi.fn(async () => {}); // real login() drives a real form — not under test here
        return tour;
    }

    it('logs in before navigating, the first time a demo-domain target is reached', async () => {
        const page = makeFakePage('https://www.cyberverse.example/solutions');
        const tour = makeAuthedTour(page);

        await tour.goto('https://demo.cyberverse.example/dashboard');

        expect(tour.login).toHaveBeenCalledTimes(1);
        expect(tour.loggedIn).toBe(true);
        // Login happens before the real navigation, not after.
        expect(tour.login.mock.invocationCallOrder[0]).toBeLessThan(page.goto.mock.invocationCallOrder[0]);
    });

    it('does not log in again on a later return to the demo domain in the same tour', async () => {
        const page = makeFakePage('https://www.cyberverse.example/solutions');
        const tour = makeAuthedTour(page);

        await tour.goto('https://demo.cyberverse.example/dashboard');
        await tour.goto('https://demo.cyberverse.example/reports');

        expect(tour.login).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight login between background prewarm and foreground navigation', async () => {
        const page = makeFakePage('about:blank');
        const tour = makeAuthedTour(page);
        let finishLogin;
        tour.login = vi.fn(() => new Promise((resolve) => { finishLogin = resolve; }));

        const prewarm = tour.prepare({ loginTargetUrl: 'https://demo.cyberverse.example/dashboard' });
        const navigation = tour.goto('https://demo.cyberverse.example/dashboard');
        await vi.waitFor(() => expect(tour.login).toHaveBeenCalledTimes(1));
        finishLogin();
        await Promise.all([prewarm, navigation]);

        expect(tour.login).toHaveBeenCalledTimes(1);
        expect(tour.loggedIn).toBe(true);
    });

    it('runs prewarmed login in an isolated page while keeping the visible page untouched', async () => {
        const visiblePage = makeFakePage('about:blank');
        const loginPage = { ...makeFakePage('about:blank'), close: vi.fn(async () => {}) };
        const tour = makeAuthedTour(visiblePage);
        tour.context = { newPage: vi.fn(async () => loginPage) };
        tour.login = vi.fn(async () => {});

        await tour.prepare({ loginTargetUrl: 'https://demo.cyberverse.example/dashboard' });

        expect(tour.context.newPage).toHaveBeenCalledTimes(1);
        expect(tour.login).toHaveBeenCalledWith(loginPage);
        expect(loginPage.close).toHaveBeenCalledTimes(1);
        expect(visiblePage.goto).not.toHaveBeenCalled();
    });

    it('never logs in for a target outside the demo domain, regardless of loggedIn state', async () => {
        const page = makeFakePage('https://www.cyberverse.example/solutions');
        const tour = makeAuthedTour(page);

        await tour.goto('https://www.cyberverse.example/references');

        expect(tour.login).not.toHaveBeenCalled();
        expect(tour.loggedIn).toBe(false);
    });

    it('does nothing extra when there are no demo credentials configured at all', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page); // no auth
        tour.login = vi.fn(async () => {});

        await tour.goto('/pricing');

        expect(tour.login).not.toHaveBeenCalled();
    });
});

describe('GuidedTour#close', () => {
    it('resets loggedIn — a fresh open() afterwards is a fresh browser with no cookies', async () => {
        const tour = new GuidedTour({ startUrl: 'https://salesai.example' });
        tour.loggedIn = true;
        tour.browser = { close: vi.fn(async () => {}) };
        // activeBrowsers isn't exported; close() tolerates a browser it never registered.

        await tour.close();

        expect(tour.loggedIn).toBe(false);
    });
});

describe('GuidedTour#highlight', () => {
    it('outlines and scrolls to the element when found', async () => {
        const element = makeFakeElement({ tagName: 'BUTTON' });
        const locator = makeFakeLocator({ element });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        await tour.highlight('text=Ücretler');

        expect(page.locator).toHaveBeenCalledWith('text=Ücretler');
        expect(locator.evaluate).toHaveBeenCalled();
        expect(element.style.outline).toBe('3px solid #6d5efc');
        expect(element.scrollIntoView).toHaveBeenCalled();
    });

    it('silently no-ops when the selector matches nothing (does not throw)', async () => {
        const locator = makeFakeLocator({ waitForError: new Error('timeout') });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        await expect(tour.highlight('text=Nope')).resolves.toBeUndefined();
        expect(locator.evaluate).not.toHaveBeenCalled();
    });
});

describe('GuidedTour#click', () => {
    it('clicks a safe element (e.g. a nav link/button) and re-checks the trust boundary', async () => {
        const element = makeFakeElement({ tagName: 'A' });
        const locator = makeFakeLocator({ element });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        const result = await tour.click('text=Ürünler');

        expect(page.click).toHaveBeenCalledWith('text=Ürünler');
        expect(result).toEqual({ ok: true, found: true, clicked: true });
    });

    it.each([
        ['input', null],
        ['textarea', null],
        ['select', null],
        ['button', 'submit']
    ])('refuses to click a %s (type=%s) — read-only mode guard', async (tagName, type) => {
        const element = makeFakeElement({ tagName: tagName.toUpperCase(), type });
        const locator = makeFakeLocator({ element });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        await expect(tour.click('button')).rejects.toThrow(/read-only mode/);
        expect(page.click).not.toHaveBeenCalled();
    });

    it('returns a soft not-found result for a not-visible selector instead of clicking blind', async () => {
        const locator = makeFakeLocator({ waitForError: new Error('timeout waiting for locator') });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        await expect(tour.click('text=Ghost')).resolves.toEqual({ ok: false, found: false, reason: 'not_visible' });
        expect(page.click).not.toHaveBeenCalled();
    });

    it('does not collapse an already-expanded toggle when ensureExpanded is true', async () => {
        const element = makeFakeElement({
            tagName: 'BUTTON',
            expanded: true,
            controlsId: 'faq-answer',
            visibleText: 'Midas uygulamasında Yatırım Hesabı bölümünü açın.'
        });
        const locator = makeFakeLocator({ element });
        const page = makeFakePage('https://salesai.example/faq');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        const result = await tour.click('[aria-controls="faq-answer"]', { ensureExpanded: true });

        expect(page.click).not.toHaveBeenCalled();
        expect(result).toEqual({
            ok: true,
            found: true,
            clicked: false,
            expanded: true,
            visibleText: 'Midas uygulamasında Yatırım Hesabı bölümünü açın.'
        });
    });

    it('opens a collapsed toggle and returns its post-click state', async () => {
        const element = makeFakeElement({
            tagName: 'BUTTON',
            expanded: false,
            controlsId: 'faq-answer',
            visibleText: 'PDF yalnızca hesaplama sırasında işlenir.'
        });
        const locator = makeFakeLocator({ element });
        const page = makeFakePage('https://salesai.example/faq');
        page.locator = vi.fn(() => locator);
        page.click = vi.fn(async () => element._setAttribute('aria-expanded', 'true'));
        const tour = makeTour(page);

        const result = await tour.click('[aria-controls="faq-answer"]', { ensureExpanded: true });

        expect(page.click).toHaveBeenCalledWith('[aria-controls="faq-answer"]');
        expect(result).toEqual({
            ok: true,
            found: true,
            clicked: true,
            expanded: true,
            visibleText: 'PDF yalnızca hesaplama sırasında işlenir.'
        });
    });

    it('throws if the click lands the page outside the trusted domain', async () => {
        const element = makeFakeElement({ tagName: 'A' });
        const locator = makeFakeLocator({ element });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        page.click = vi.fn(async () => page._setUrl('https://untrusted.example/hijacked'));
        const tour = makeTour(page);

        await expect(tour.click('text=Ürünler')).rejects.toThrow(/landed outside the trusted domain/);
    });
});

/**
 * `scroll()` does its DOM work inside `page.evaluate`, which needs a real
 * browser; what is testable here is the Node-side half — argument validation,
 * reading the position back only *after* the smooth-scroll animation, and
 * turning that position into the atTop/atBottom hints the agent reasons over.
 */
function makeScrollablePage(position) {
    const page = makeFakePage('https://salesai.example/dashboard');
    const calls = [];
    page.evaluate = vi.fn(async (_fn, arg) => {
        calls.push({ kind: 'evaluate', arg });
        // First call performs the scroll; the second reads the position back.
        return page.evaluate.mock.calls.length === 1 ? undefined : position;
    });
    page.waitForTimeout = vi.fn(async (ms) => {
        calls.push({ kind: 'wait', ms });
    });
    return { page, calls };
}

describe('GuidedTour#scroll', () => {
    it('forwards the direction and amount to the browser-side scroll', async () => {
        const { page } = makeScrollablePage({ scrollTop: 800, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        await tour.scroll('up', 2);

        expect(page.evaluate.mock.calls[0][1]).toEqual({ direction: 'up', amount: 2 });
    });

    it('defaults to one screen down', async () => {
        const { page } = makeScrollablePage({ scrollTop: 0, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        await tour.scroll();

        expect(page.evaluate.mock.calls[0][1]).toEqual({ direction: 'down', amount: 1 });
    });

    it('rejects an unsupported direction without touching the page', async () => {
        const { page } = makeScrollablePage({ scrollTop: 0, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        await expect(tour.scroll('sideways')).rejects.toThrow(/Unsupported scroll direction/);
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('reads the final position only after waiting out the smooth-scroll animation', async () => {
        const { page, calls } = makeScrollablePage({ scrollTop: 800, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        await tour.scroll('down');

        expect(calls.map((c) => c.kind)).toEqual(['evaluate', 'wait', 'evaluate']);
        expect(calls[1].ms).toBeGreaterThan(0);
    });

    it('reports atTop when nothing has been scrolled yet', async () => {
        const { page } = makeScrollablePage({ scrollTop: 0, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        expect(await tour.scroll('top')).toMatchObject({ atTop: true, atBottom: false });
    });

    it('reports atBottom once the last screen is showing, so the agent stops scrolling', async () => {
        const { page } = makeScrollablePage({ scrollTop: 3000, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        expect(await tour.scroll('bottom')).toMatchObject({ atTop: false, atBottom: true });
    });

    it('reports neither end mid-page, so the agent knows there is more to show', async () => {
        const { page } = makeScrollablePage({ scrollTop: 1200, scrollHeight: 4000, clientHeight: 1000, visibleHeadings: ['Features', 'Pricing'] });
        const tour = makeTour(page);

        expect(await tour.scroll('down')).toMatchObject({
            atTop: false,
            atBottom: false,
            scrollTop: 1200,
            visibleHeadings: ['Features', 'Pricing']
        });
    });

    it('supports targeted scrolling to a selector or heading element', async () => {
        const { page } = makeScrollablePage({ scrollTop: 2500, scrollHeight: 4000, clientHeight: 1000 });
        const targetEl = { scrollIntoView: vi.fn() };
        const locator = {
            first: () => locator,
            count: vi.fn().mockResolvedValue(1),
            evaluate: vi.fn().mockImplementation(async (fn) => fn(targetEl))
        };
        page.locator = vi.fn().mockReturnValue(locator);
        const tour = makeTour(page);

        const result = await tour.scroll({ target: 'pricing' });

        expect(page.locator).toHaveBeenCalledWith('text=pricing');
        expect(locator.evaluate).toHaveBeenCalled();
        expect(result.targetFound).toBe(true);
    });
});
