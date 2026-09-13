import { describe, expect, it, vi } from 'vitest';
import { BrowserCapacity } from './browser-capacity.js';
import { ChromeMcpTour, selectedPage, uidFor } from './chrome-mcp-tour.js';

function result(text, extra = {}) {
    return { ok: true, isError: false, content: [{ type: 'text', text }], ...extra };
}

async function loginEvaluation(_name, { function: source }) {
    if (source.startsWith('(...elements)')) return result(JSON.stringify({ indices: [0, 1, 2] }));
    if (source.startsWith('(user, pass')) return result(JSON.stringify({ sameForm: true, usernameMatches: true, passwordMatches: true, valid: true }));
    await this.callTool('take_snapshot');
    return result(JSON.stringify({ passwordVisible: true, hasError: false }));
}

describe('ChromeMcpTour helpers', () => {
    it('extracts the selected page and live element UIDs from MCP text', () => {
        expect(selectedPage(result('## Pages\n2: Dashboard (https://demo.example/app) [selected]')))
            .toEqual({ pageId: 2, url: 'https://demo.example/app' });
        expect(selectedPage(result('## Pages\n2: https://demo.example/login [selected]')))
            .toEqual({ pageId: 2, url: 'https://demo.example/login' });
        expect(uidFor(result('uid=4_1 textbox "Email"\nuid=4_2 textbox "Password"'), [/textbox.*email/i]))
            .toBe('4_1');
    });
});

describe('ChromeMcpTour', () => {
    it('can retry preparation after the MCP connection fails once', async () => {
        const capacity = new BrowserCapacity({ limit: 1 });
        const adapter = {
            connect: vi.fn()
                .mockRejectedValueOnce(new Error('startup failed'))
                .mockResolvedValue(undefined),
            callTool: vi.fn(async () => result('ok')),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter, capacity });

        await expect(tour.prepare()).rejects.toThrow('startup failed');
        await expect(tour.prepare()).resolves.toBe(tour);
        expect(adapter.connect).toHaveBeenCalledTimes(2);
        await tour.close();
    });

    it('opens through MCP, tracks the selected page, and returns its screenshot bytes', async () => {
        const png = Buffer.from('png bytes');
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example/home) [selected]');
                if (name === 'take_screenshot') {
                    return { ok: true, content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }] };
                }
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter });

        await tour.open('https://demo.example/home');

        expect(adapter.callTool).toHaveBeenCalledWith('new_page', { url: 'https://demo.example/home' });
        await expect(tour.screenshot()).resolves.toEqual(png);
        await tour.close();
    });

    it('blocks untrusted navigation before calling MCP', async () => {
        const adapter = { connect: vi.fn(async () => {}), callTool: vi.fn(), close: vi.fn() };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter });

        await expect(tour.goto('https://attacker.example')).rejects.toThrow(/outside trusted/);
        expect(adapter.callTool).not.toHaveBeenCalled();
    });

    it('refuses a live link UID whose observed destination is outside the product domains', async () => {
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'new_page') return result('ok');
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example) [selected]');
                if (name === 'take_snapshot') return result('uid=2_1 link "Leave" url="https://attacker.example"');
                return result('clicked');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter });
        await tour.open();
        await tour.observe();

        await expect(tour.perform('click', { uid: '2_1' })).rejects.toThrow(/untrusted URL/);
        expect(adapter.callTool).not.toHaveBeenCalledWith('click', expect.anything());
        await tour.close();
    });

    it('uses live snapshot UIDs to prepare demo login without exposing selectors', async () => {
        let pageUrl = 'https://demo.example/login';
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') return result([
                    'uid=1_1 textbox "Email"',
                    'uid=1_2 textbox "Password"',
                    'uid=1_3 button "Giriş Yap"'
                ].join('\n'));
                if (name === 'click') pageUrl = 'https://demo.example/dashboard';
                if (name === 'list_pages') return result(`## Pages\n1: Demo (${pageUrl}) [selected]`);
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' },
            adapter
        });

        await tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' });

        expect(adapter.callTool).toHaveBeenCalledWith('fill_form', expect.objectContaining({
            elements: [
                { uid: '1_1', value: 'demo@example.test' },
                { uid: '1_2', value: 'secret' }
            ]
        }));
        expect(tour.loggedIn).toBe(true);
        await tour.close();
    });

    it.each([
        [{ sameForm: false }, /changed form/, 1],
        [{ usernameMatches: false }, /did not persist/, 2],
        [{ valid: false }, /validation failed/, 1]
    ])('refuses submit when DOM verification fails: %j', async (failure, error, fills) => {
        const adapter = {
            connect: vi.fn(async () => {}),
            close: vi.fn(async () => {}),
            callTool: vi.fn(async name => {
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example/login) [selected]');
                if (name === 'take_snapshot') return result('uid=1_1 textbox "Email"\nuid=1_2 textbox "Password"\nuid=1_3 button "Submit"');
                return result('ok');
            }),
            callInternalTool: vi.fn(async (_name, { function: source }) => result(JSON.stringify(
                source.startsWith('(...elements)') ? { indices: [0, 1, 2] }
                    : { sameForm: true, usernameMatches: true, passwordMatches: true, valid: true, ...failure }
            )))
        };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter,
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' } });
        try {
            await expect(tour.prepare({ loginTargetUrl: 'https://demo.example' })).rejects.toThrow(error);
            expect(adapter.callTool.mock.calls.filter(([name]) => name === 'fill_form')).toHaveLength(fills);
            expect(adapter.callTool.mock.calls.some(([name]) => name === 'click')).toBe(false);
            expect(tour.loggedIn).toBe(false);
        } finally { await tour.close(); }
    });

    it('waits for an asynchronous login redirect before declaring the form stuck', async () => {
        let pageUrl = 'https://demo.example/login';
        let verificationSnapshots = 0;
        let submitted = false;
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') {
                    if (submitted && ++verificationSnapshots === 2) {
                        pageUrl = 'https://demo.example/dashboard';
                    }
                    return result([
                        'uid=1_1 textbox "Email"',
                        'uid=1_2 textbox "Password"',
                        'uid=1_3 button "Giriş Yap"'
                    ].join('\n'));
                }
                if (name === 'click') submitted = true;
                if (name === 'list_pages') return result(`## Pages\n1: Demo (${pageUrl}) [selected]`);
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' },
            adapter,
            loginVerificationPollMs: 0
        });

        await tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' });

        expect(verificationSnapshots).toBe(2);
        expect(tour.loggedIn).toBe(true);
        await tour.close();
    });

    it('times out when the submitted login form remains visible', async () => {
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') return result([
                    'uid=1_1 textbox "Email"',
                    'uid=1_2 textbox "Password"',
                    'uid=1_3 button "Giriş Yap"'
                ].join('\n'));
                if (name === 'list_pages') {
                    return result('## Pages\n1: Demo (https://demo.example/login) [selected]');
                }
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' },
            adapter,
            loginVerificationTimeoutMs: 0,
            loginVerificationPollMs: 0
        });

        await expect(tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' }))
            .rejects.toThrow(/did not complete within 0ms/);
        expect(tour.loggedIn).toBe(false);
        await tour.close();
    });

    // The generic `loginEvaluation` helper above always returns canned success
    // indices for the login probe function regardless of what was actually
    // probed, so it can't simulate a form still rendering. These two tests
    // instead gate on how many login-relevant elements the current snapshot
    // exposes — mirroring how `loginProbe` really only finds candidates once
    // the client-side render/redirect has caught up.
    async function progressiveLoginEvaluation(_name, { function: source, args }) {
        if (source.startsWith('(...elements)')) {
            return args.length >= 3
                ? result(JSON.stringify({ indices: [0, 1, 2] }))
                : result(JSON.stringify({ error: 'A unique password field with a native form is required.' }));
        }
        if (source.startsWith('(user, pass')) return result(JSON.stringify({ sameForm: true, usernameMatches: true, passwordMatches: true, valid: true }));
        return result(JSON.stringify({ passwordVisible: true, hasError: false }));
    }

    it('retries the login snapshot until the password form finishes rendering', async () => {
        let pageUrl = 'https://demo.example/login';
        let snapshotCalls = 0;
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: progressiveLoginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') {
                    snapshotCalls++;
                    // First two snapshots land mid client-side redirect/hydration: no form yet.
                    if (snapshotCalls <= 2) return result('uid=1_0 heading "Loading…"');
                    return result([
                        'uid=1_1 textbox "Email"',
                        'uid=1_2 textbox "Password"',
                        'uid=1_3 button "Giriş Yap"'
                    ].join('\n'));
                }
                if (name === 'click') pageUrl = 'https://demo.example/dashboard';
                if (name === 'list_pages') return result(`## Pages\n1: Demo (${pageUrl}) [selected]`);
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' },
            adapter,
            loginFormPollMs: 0
        });

        await tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' });

        expect(snapshotCalls).toBe(3);
        expect(tour.loggedIn).toBe(true);
        await tour.close();
    });

    it('gives up on a login form that never renders within the timeout budget', async () => {
        const adapter = {
            connect: vi.fn(async () => {}),
            close: vi.fn(async () => {}),
            callInternalTool: progressiveLoginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') return result('uid=1_0 heading "Loading…"');
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example/login) [selected]');
                return result('ok');
            })
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' },
            adapter,
            loginFormTimeoutMs: 0,
            loginFormPollMs: 0
        });

        await expect(tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' }))
            .rejects.toThrow(/unique password field/);
        expect(tour.loggedIn).toBe(false);
        await tour.close();
    });

    it('uses an mcpSelectors override to resolve a login control auto-detect misses', async () => {
        let pageUrl = 'https://demo.example/login';
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') return result([
                    'uid=1_1 textbox "Kurum Kodu"',
                    'uid=1_2 textbox "Password"',
                    'uid=1_3 button "Giriş Yap"'
                ].join('\n'));
                if (name === 'click') pageUrl = 'https://demo.example/dashboard';
                if (name === 'list_pages') return result(`## Pages\n1: Demo (${pageUrl}) [selected]`);
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: {
                loginUrl: 'https://demo.example/login',
                email: 'demo@example.test',
                password: 'secret',
                mcpSelectors: { username: 'textbox.*Kurum Kodu' }
            },
            adapter
        });

        await tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' });

        expect(adapter.callTool).toHaveBeenCalledWith('fill_form', expect.objectContaining({
            elements: [
                { uid: '1_1', value: 'demo@example.test' },
                { uid: '1_2', value: 'secret' }
            ]
        }));
        await tour.close();
    });

    it('accepts a cookie banner through MCP before resolving the login form', async () => {
        let cookieVisible = true;
        let pageUrl = 'https://demo.example/login';
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name, args) => {
                if (name === 'take_snapshot') {
                    return result([
                        ...(cookieVisible ? ['uid=1_0 dialog "Çerez tercihleri"', 'uid=1_4 button "Tümünü Kabul Et"'] : []),
                        'uid=1_1 textbox "Email"',
                        'uid=1_2 textbox "Password"',
                        'uid=1_3 button "Giriş Yap"'
                    ].join('\n'));
                }
                if (name === 'click' && args.uid === '1_4') cookieVisible = false;
                if (name === 'click' && args.uid === '1_3') pageUrl = 'https://demo.example/dashboard';
                if (name === 'list_pages') return result(`## Pages\n1: Demo (${pageUrl}) [selected]`);
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: { loginUrl: 'https://demo.example/login', email: 'demo@example.test', password: 'secret' },
            adapter
        });

        await tour.prepare({ loginTargetUrl: 'https://demo.example/dashboard' });

        expect(adapter.callTool).toHaveBeenCalledWith('click', expect.objectContaining({ uid: '1_4' }));
        expect(tour.loggedIn).toBe(true);
        await tour.close();
    });

    it('blocks a destructive model click found in the latest live snapshot', async () => {
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'new_page') return result('ok');
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example) [selected]');
                if (name === 'take_snapshot') return result('uid=2_1 button "Hesabı Sil"');
                return result('clicked');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter });
        await tour.open();
        await tour.observe();

        await expect(tour.perform('click', { uid: '2_1' })).rejects.toThrow(/destructive/);
        await tour.close();
    });

    it('returns normalized live element geometry through the internal probe', async () => {
        const adapter = {
            connect: vi.fn(async () => {}),
            callTool: vi.fn(async (name) => {
                if (name === 'new_page') return result('ok');
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example) [selected]');
                if (name === 'take_snapshot') return result('uid=2_1 button "Raporlar"');
                return result('ok');
            }),
            callInternalTool: vi.fn(async () => result(JSON.stringify({
                visible: true,
                viewport: { width: 1000, height: 500 },
                rect: { x: 200, y: 100, width: 100, height: 50 },
                clientRects: []
            }))),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter });
        await tour.open();
        await tour.observe();

        await expect(tour.describeElement('2_1')).resolves.toMatchObject({
            geometry: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }
        });
        expect(adapter.callInternalTool).toHaveBeenCalledWith('evaluate_script', expect.objectContaining({
            pageId: 1, args: ['2_1'], waitForStableDom: false
        }));
        await tour.close();
    });

    it('fails loudly when a configured mcpSelectors override matches nothing', async () => {
        const adapter = {
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async (name) => {
                if (name === 'take_snapshot') return result('uid=1_1 textbox "Email"\nuid=1_2 textbox "Password"');
                if (name === 'list_pages') return result('## Pages\n1: Demo (https://demo.example/login) [selected]');
                return result('ok');
            }),
            close: vi.fn(async () => {})
        };
        const tour = new ChromeMcpTour({
            startUrl: 'https://demo.example',
            auth: {
                loginUrl: 'https://demo.example/login',
                email: 'demo@example.test',
                password: 'secret',
                mcpSelectors: { username: 'textbox.*Kurum Kodu' }
            },
            adapter
        });

        await expect(tour.prepare({ loginTargetUrl: 'https://demo.example/login' }))
            .rejects.toThrow(/mcpSelectors\.username matched nothing/);
        await tour.close();
    });

    it('shares browser capacity with other tour drivers and returns its lease on close', async () => {
        const capacity = new BrowserCapacity({ limit: 1 });
        const adapter = () => ({
            connect: vi.fn(async () => {}),
            callInternalTool: loginEvaluation,
            callTool: vi.fn(async () => result('ok')),
            close: vi.fn(async () => {})
        });
        const first = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter: adapter(), capacity });
        const second = new ChromeMcpTour({ startUrl: 'https://demo.example', adapter: adapter(), capacity });

        await first.prepare();
        await expect(second.prepare()).rejects.toThrow(/limit reached \(1\)/);
        await first.close();
        await expect(second.prepare()).resolves.toBe(second);
        await second.close();
    });
});
