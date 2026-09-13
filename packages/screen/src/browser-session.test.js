import { describe, expect, it, vi } from 'vitest';
import { BrowserSession } from './browser-session.js';

function driver(overrides = {}) {
    return {
        prepare: vi.fn(async () => 'prepared'),
        open: vi.fn(async () => 'opened'),
        goto: vi.fn(async () => 'navigated'),
        highlight: vi.fn(async () => 'highlighted'),
        click: vi.fn(async () => 'clicked'),
        scroll: vi.fn(async () => 'scrolled'),
        screenshot: vi.fn(async () => Buffer.from('frame')),
        close: vi.fn(async () => {}),
        ...overrides
    };
}

describe('BrowserSession', () => {
    it('serializes browser mutations in call order', async () => {
        let releaseFirst;
        const events = [];
        const fakeDriver = driver({
            goto: vi.fn(async () => {
                events.push('goto:start');
                await new Promise((resolve) => { releaseFirst = resolve; });
                events.push('goto:end');
            }),
            click: vi.fn(async () => events.push('click'))
        });
        const session = new BrowserSession({ driver: fakeDriver, provider: 'test' });

        const navigation = session.goto('/reports');
        const click = session.click('button');
        await vi.waitFor(() => expect(events).toEqual(['goto:start']));
        releaseFirst();
        await Promise.all([navigation, click]);

        expect(events).toEqual(['goto:start', 'goto:end', 'click']);
    });

    it('continues after a failed operation without poisoning the queue', async () => {
        const fakeDriver = driver({
            goto: vi.fn(async () => { throw new Error('navigation failed'); })
        });
        const session = new BrowserSession({ driver: fakeDriver });

        await expect(session.goto('/broken')).rejects.toThrow('navigation failed');
        await expect(session.click('button')).resolves.toBe('clicked');
    });

    it('recovers a failed driver without permanently closing the session', async () => {
        const fakeDriver = driver({
            recover: vi.fn(async () => {}),
            open: vi.fn()
                .mockRejectedValueOnce(new Error('first open failed'))
                .mockResolvedValue('opened')
        });
        const session = new BrowserSession({ driver: fakeDriver, provider: 'chrome-mcp' });

        await expect(session.open('/first')).rejects.toThrow('first open failed');
        await expect(session.recover()).resolves.toBe(true);
        await expect(session.open('/second')).resolves.toBe('opened');
        expect(fakeDriver.recover).toHaveBeenCalledTimes(1);
    });

    it('queues playbook open behind an in-flight prewarm on the same driver', async () => {
        let finishPrepare;
        const events = [];
        const fakeDriver = driver({
            prepare: vi.fn(async () => {
                events.push('prepare:start');
                await new Promise((resolve) => { finishPrepare = resolve; });
                events.push('prepare:end');
            }),
            open: vi.fn(async () => events.push('open'))
        });
        const session = new BrowserSession({ driver: fakeDriver, provider: 'chrome-mcp' });

        const prewarm = session.prepare({ loginTargetUrl: 'https://demo.example/dashboard' });
        const playbookOpen = session.open('https://demo.example/results');
        await vi.waitFor(() => expect(events).toEqual(['prepare:start']));
        finishPrepare();
        await Promise.all([prewarm, playbookOpen]);

        expect(events).toEqual(['prepare:start', 'prepare:end', 'open']);
    });

    it('closes once and rejects later operations', async () => {
        const fakeDriver = driver();
        const session = new BrowserSession({ driver: fakeDriver });

        await session.close();
        await session.close();

        expect(fakeDriver.close).toHaveBeenCalledTimes(1);
        await expect(session.goto('/later')).rejects.toThrow(/closed/);
    });

    it('shares one close operation across concurrent callers', async () => {
        const fakeDriver = driver();
        const session = new BrowserSession({ driver: fakeDriver });

        await Promise.all([session.close(), session.close()]);

        expect(fakeDriver.close).toHaveBeenCalledTimes(1);
    });
});
