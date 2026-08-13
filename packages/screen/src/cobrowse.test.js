import { describe, it, expect, vi } from 'vitest';
import { trustKey, assertHttpUrl, authRouteKey, GuidedTour } from './cobrowse.js';

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

function makeFakeElement({ tagName = 'DIV', type = null } = {}) {
    return {
        tagName,
        getAttribute: (name) => (name === 'type' ? type : null),
        style: {},
        scrollIntoView: vi.fn()
    };
}

/** A GuidedTour that trusts salesai.example, with its browser bits swapped for fakes. */
function makeTour(page) {
    const tour = new GuidedTour({ startUrl: 'https://salesai.example/dashboard' });
    tour.page = page;
    return tour;
}

describe('GuidedTour#goto', () => {
    it('resolves an in-app relative path against the current page before navigating', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        await tour.goto('/pricing');

        expect(page.goto).toHaveBeenCalledWith('https://salesai.example/pricing', { waitUntil: 'domcontentloaded' });
    });

    it('navigates directly to an already-absolute trusted URL', async () => {
        const page = makeFakePage('https://salesai.example/dashboard');
        const tour = makeTour(page);

        await tour.goto('https://salesai.example/settings');

        expect(page.goto).toHaveBeenCalledWith('https://salesai.example/settings', { waitUntil: 'domcontentloaded' });
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

        await tour.click('text=Ürünler');

        expect(page.click).toHaveBeenCalledWith('text=Ürünler');
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

    it('propagates a not-visible timeout instead of clicking blind', async () => {
        const locator = makeFakeLocator({ waitForError: new Error('timeout waiting for locator') });
        const page = makeFakePage('https://salesai.example/dashboard');
        page.locator = vi.fn(() => locator);
        const tour = makeTour(page);

        await expect(tour.click('text=Ghost')).rejects.toThrow(/timeout waiting for locator/);
        expect(page.click).not.toHaveBeenCalled();
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
        const { page } = makeScrollablePage({ scrollTop: 1200, scrollHeight: 4000, clientHeight: 1000 });
        const tour = makeTour(page);

        expect(await tour.scroll('down')).toMatchObject({ atTop: false, atBottom: false, scrollTop: 1200 });
    });
});
