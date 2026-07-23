import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGracefulShutdown } from './shutdown.js';

/** A fake HTTP server whose close() calls back once `resolveClose()` is invoked. */
function fakeServer() {
    let resolveClose;
    const server = {
        close: vi.fn((cb) => {
            resolveClose = cb;
        })
    };
    return { server, finishClose: () => resolveClose?.() };
}

describe('runGracefulShutdown', () => {
    it('closes only the realtime server (which also closes the http server), then runs every task, then exits(0)', async () => {
        // Socket.IO's close() closes the underlying http.Server it was given —
        // calling server.close() as well would always fail with "Server is
        // not running", so it must NOT be called when realtime is present.
        const order = [];
        const realtime = { close: vi.fn(async () => order.push('realtime')) };
        const server = { close: vi.fn() };
        const task = vi.fn(async () => order.push('task'));
        const exit = vi.fn();

        await runGracefulShutdown({ server, realtime, tasks: [{ name: 'a', fn: task }], exit });

        expect(order).toEqual(['realtime', 'task']);
        expect(server.close).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('falls back to closing the http server directly when there is no realtime server', async () => {
        const server = { close: vi.fn((cb) => cb()) };
        const exit = vi.fn();
        await expect(runGracefulShutdown({ server, tasks: [], exit })).resolves.toBeUndefined();
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('runs every cleanup task even when one rejects, and still exits(0)', async () => {
        const server = { close: vi.fn((cb) => cb()) };
        const good = vi.fn().mockResolvedValue();
        const bad = vi.fn().mockRejectedValue(new Error('mongo is stuck'));
        const exit = vi.fn();

        await runGracefulShutdown({
            server,
            tasks: [
                { name: 'bad-task', fn: bad },
                { name: 'good-task', fn: good }
            ],
            exit
        });

        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    describe('drain timeout', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('force-proceeds to cleanup tasks and exits if the drain never finishes', async () => {
            const { server } = fakeServer(); // close() never calls back — simulates a stuck drain
            const task = vi.fn().mockResolvedValue();
            const exit = vi.fn();

            const promise = runGracefulShutdown({ server, tasks: [{ name: 'a', fn: task }], drainTimeoutMs: 5000, exit });
            await vi.advanceTimersByTimeAsync(5000);
            await promise;

            expect(task).toHaveBeenCalledTimes(1);
            expect(exit).toHaveBeenCalledWith(0);
        });

        it('does not wait the full timeout when the drain finishes on its own', async () => {
            const { server, finishClose } = fakeServer();
            const exit = vi.fn();

            const promise = runGracefulShutdown({ server, tasks: [], drainTimeoutMs: 5000, exit });
            finishClose();
            await vi.advanceTimersByTimeAsync(0);
            await promise;

            expect(exit).toHaveBeenCalledWith(0);
        });
    });
});
