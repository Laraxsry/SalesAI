import { describe, expect, it, vi } from 'vitest';
import { loginWithCredentials } from './credential-login.js';

function locator({ visible = () => false, click, fill, press, text = '' } = {}) {
    return {
        first() { return this; },
        count: vi.fn(async () => visible() ? 1 : 0),
        isVisible: vi.fn(async () => visible()),
        click: vi.fn(async () => click?.()),
        fill: vi.fn(async (value) => fill?.(value)),
        press: vi.fn(async (key) => press?.(key)),
        textContent: vi.fn(async () => text)
    };
}

describe('loginWithCredentials', () => {
    it('recovers from a root URL that redirects to signup, then logs in', async () => {
        let url = 'about:blank';
        let submitted = false;
        const values = {};
        const page = {
            frames: () => [page],
            url: () => url,
            goto: vi.fn(async () => { url = 'https://app.example/signup'; }),
            waitForTimeout: vi.fn(async () => {}),
            waitForLoadState: vi.fn(async () => {}),
            locator: vi.fn((selector) => {
                if (selector === 'a:has-text("Log in")') {
                    return locator({ visible: () => url.endsWith('/signup'), click: () => { url = 'https://app.example/login'; } });
                }
                if (selector === 'input[type="email"]') {
                    return locator({ visible: () => url.endsWith('/login'), fill: (value) => { values.username = value; } });
                }
                if (selector === 'input[type="password"]') {
                    return locator({ visible: () => url.endsWith('/login') && !submitted, fill: (value) => { values.password = value; } });
                }
                if (selector === 'button[type="submit"]') {
                    return locator({
                        visible: () => url.endsWith('/login'),
                        click: () => { submitted = true; url = 'https://app.example/dashboard'; }
                    });
                }
                return locator();
            })
        };

        await loginWithCredentials(page, {
            loginUrl: 'https://app.example/',
            username: 'demo@example.com',
            password: 'secret'
        });

        expect(values).toEqual({ username: 'demo@example.com', password: 'secret' });
        expect(url).toBe('https://app.example/dashboard');
    });

    it('supports username-first forms that reveal the password after Next', async () => {
        let stage = 'username';
        let url = 'about:blank';
        const page = {
            frames: () => [page],
            url: () => url,
            goto: vi.fn(async () => { url = 'https://app.example/login'; }),
            waitForTimeout: vi.fn(async () => {}),
            waitForLoadState: vi.fn(async () => {}),
            locator: vi.fn((selector) => {
                if (selector === 'input[type="email"]') return locator({ visible: () => stage === 'username' });
                if (selector === 'input[type="password"]') return locator({ visible: () => stage === 'password' });
                if (selector === 'button[type="submit"]') {
                    return locator({
                        visible: () => stage !== 'done',
                        click: () => {
                            if (stage === 'username') stage = 'password';
                            else { stage = 'done'; url = 'https://app.example/home'; }
                        }
                    });
                }
                return locator();
            })
        };

        await loginWithCredentials(page, {
            loginUrl: 'https://app.example/login',
            username: 'demo@example.com',
            password: 'secret'
        });

        expect(stage).toBe('done');
        expect(url).toBe('https://app.example/home');
    });

    it('prints a trace of navigations and the failed form step when login fails', async () => {
        let url = 'about:blank';
        const handlers = {};
        const mainFrame = {};
        const page = {
            frames: () => [page],
            mainFrame: () => mainFrame,
            on: (event, handler) => { handlers[event] = handler; },
            title: vi.fn(async () => 'Sign up'),
            url: () => url,
            goto: vi.fn(async () => {
                url = 'https://app.example/signup';
                handlers.framenavigated?.({ url: () => url, ...mainFrame });
            }),
            waitForTimeout: vi.fn(async () => {}),
            waitForLoadState: vi.fn(async () => {}),
            locator: vi.fn(() => locator())
        };
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(loginWithCredentials(page, {
            loginUrl: 'https://app.example/',
            username: 'demo@example.com',
            password: 'secret'
        })).rejects.toThrow(/registration page and no login link/);

        const output = errors.mock.calls.map((call) => call.join(' ')).join('\n');
        errors.mockRestore();
        expect(output).toContain('goto https://app.example');
        expect(output).not.toContain('secret');
    });

    it('detects a login that finishes while the poll is sleeping past the deadline', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            let url = 'about:blank';
            let clicked = false;
            const errorLocator = locator({ visible: () => false });
            const page = {
                frames: () => [page],
                url: () => url,
                goto: vi.fn(async () => { url = 'https://app.example/login'; }),
                // The site finishes logging in during the first sleep, and the
                // sleep overshoots the whole 12s window (a slow machine).
                waitForTimeout: vi.fn(async () => {
                    if (clicked) url = 'https://app.example/dashboard';
                    vi.setSystemTime(Date.now() + 30_000);
                }),
                waitForLoadState: vi.fn(async () => {}),
                locator: vi.fn((selector) => {
                    if (selector === 'input[type="email"]') return locator({ visible: () => true });
                    if (selector === 'input[type="password"]') return locator({ visible: () => true });
                    if (selector === 'button[type="submit"]') return locator({ visible: () => true, click: () => { clicked = true; } });
                    if (selector.includes('[role="alert"]')) return errorLocator;
                    return locator();
                })
            };

            await loginWithCredentials(page, {
                loginUrl: 'https://app.example/login',
                username: 'demo@example.com',
                password: 'secret'
            });

            expect(url).toBe('https://app.example/dashboard');
            // The error element never exists here, so it must not be awaited for.
            expect(errorLocator.textContent).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
