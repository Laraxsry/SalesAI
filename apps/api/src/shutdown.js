import { withTimeout } from '@repo/resilience';
import { Logger } from '@repo/logger';

/**
 * Stops the HTTP server (and any attached realtime/Socket.IO server) from
 * accepting new work, and resolves once every currently-open connection has
 * actually finished — this is what "let in-flight requests finish" means in
 * practice.
 *
 * When a realtime server is present, `realtime.close()` alone is enough:
 * Socket.IO's `close()` also closes the underlying `http.Server` it was
 * attached to (verified directly — it is not documented clearly either
 * way), so calling `server.close()` afterwards would always fail with
 * "Server is not running." `server.close()` is only called directly when
 * there's no realtime server to hand that responsibility to.
 *
 * @param {{ close: (cb: (err?: Error) => void) => void }} server
 * @param {{ close: () => Promise<void> } | undefined} realtime
 */
async function drain(server, realtime) {
    if (realtime) {
        await realtime.close();
        return;
    }
    await new Promise((resolve) => {
        server.close((err) => {
            if (err) Logger.warn('http server close reported an error', { error: err.message });
            resolve();
        });
    });
}

/**
 * Runs one graceful-shutdown pass: drain (bounded by `drainTimeoutMs`), then
 * run every cleanup task concurrently, then exit.
 *
 * Exported separately from `registerGracefulShutdown` below so the sequencing
 * — drain first, run every task even if one fails, always eventually exit —
 * is unit-testable with fake server/realtime/tasks and a mocked `exit`,
 * without spawning a real process per test case.
 *
 * A task failing (rejecting) never stops the others (`Promise.allSettled`):
 * a stuck Mongo disconnect, say, shouldn't also skip closing Redis. Each
 * failure is logged individually instead.
 *
 * @param {object} opts
 * @param {{ close: (cb: (err?: Error) => void) => void }} opts.server
 * @param {{ close: () => Promise<void> }} [opts.realtime]
 * @param {{ name: string, fn: () => Promise<any> }[]} opts.tasks
 * @param {number} [opts.drainTimeoutMs] - force-close the drain step past this
 * @param {(code: number) => void} [opts.exit] - injected for testability
 */
export async function runGracefulShutdown({ server, realtime, tasks, drainTimeoutMs = 10_000, exit = process.exit }) {
    try {
        await withTimeout(() => drain(server, realtime), drainTimeoutMs);
    } catch (err) {
        Logger.warn('shutdown drain did not finish in time, forcing close', { error: err.message });
    }

    const results = await Promise.allSettled(tasks.map((task) => task.fn()));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            Logger.warn(`cleanup task "${tasks[i].name}" failed during shutdown`, { error: result.reason?.message });
        }
    });

    Logger.info('graceful shutdown complete');
    exit(0);
}

/**
 * Wires SIGTERM (sent by orchestrators — Docker, Kubernetes — on shutdown)
 * and SIGINT (Ctrl+C, e.g. during local `npm run dev`) to a single graceful
 * shutdown pass. A second signal received while already shutting down is
 * ignored — a slow drain shouldn't let an impatient double Ctrl+C (or an
 * orchestrator retry) start a second, overlapping shutdown sequence.
 *
 * @param {Parameters<typeof runGracefulShutdown>[0]} opts
 */
export function registerGracefulShutdown(opts) {
    let shuttingDown = false;

    const handleSignal = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        Logger.info(`received ${signal}, starting graceful shutdown`);
        runGracefulShutdown(opts).catch((err) => {
            // runGracefulShutdown only throws if something upstream of its own
            // try/catch blows up unexpectedly (e.g. a logging call itself
            // throwing) — a case with no good recovery, so exit non-zero
            // rather than leave the process in a half-shut-down limbo.
            Logger.error('graceful shutdown failed unexpectedly', { error: err?.message });
            (opts.exit || process.exit)(1);
        });
    };

    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
}
