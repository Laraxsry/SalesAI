import { safeTourMonitor, tourActionMeta } from './tour-diagnostics.js';

const DEFAULT_TIMING = Object.freeze({
    cursorMoveMs: 420,
    hoverPauseMs: 140,
    clickPulseMs: 170,
    focusTtlMs: 3200
});

/** Presentation-only coordinator. It never owns browser lifecycle or policy. */
export function createTourChoreographer({
    browser,
    publishCue,
    getViewVersion = () => 0,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onEvent,
    now = () => Date.now(),
    timing = DEFAULT_TIMING
}) {
    let epoch = 0;
    let sequence = 0;
    const emit = safeTourMonitor(onEvent);
    emit('ready', { timing });

    async function step(context, stage, operation) {
        const started = now();
        emit('step.begin', { ...context, stage, epoch, viewVersion: getViewVersion() });
        try {
            const result = await operation();
            emit('step.end', { ...context, stage, status: 'ok', durationMs: now() - started,
                cueId: result?.cueId, target: result?.geometry, viewVersion: getViewVersion() });
            return result;
        } catch (error) {
            emit('step.end', { ...context, stage, status: 'error', durationMs: now() - started, error: error.message });
            throw error;
        }
    }

    function contextFor(action, args, operationId) {
        return { operationId: operationId ?? `choreography-${++sequence}`, ...tourActionMeta(action, args) };
    }

    async function targetFor(uid, context) {
        const described = await step(context, 'geometry', () => browser.describeElement(uid));
        return described?.geometry ?? null;
    }

    async function beforeAction(action, args = {}, operationId) {
        const context = contextFor(action, args, operationId);
        const started = now();
        emit('action.begin', { ...context, epoch, viewVersion: getViewVersion() });
        const finish = (result, reason) => {
            emit('action.end', { ...context, durationMs: now() - started, ...result, reason, viewVersion: getViewVersion() });
            return result;
        };
        const cue = payload => step(context, payload.action, () => publishCue({ ...payload, operationId: context.operationId }));
        const pause = ms => step(context, 'wait', () => wait(ms));
        const actionEpoch = epoch;
        if (action === 'pressKey' && ['PageDown', 'PageUp', 'Home', 'End'].includes(args.key)) {
            try {
                await cue({
                    action: 'scroll',
                    direction: ['PageUp', 'Home'].includes(args.key) ? 'up' : 'down',
                    viewVersion: getViewVersion(),
                    target: { x: 0.93, y: 0.48, width: 0.03, height: 0.12, rects: [] },
                    durationMs: 360
                });
                await pause(180);
                if (actionEpoch !== epoch) return finish({ decorated: true, cancelled: true }, 'epoch_changed');
                return finish({ decorated: true });
            } catch {
                return finish({ decorated: false }, 'presentation_error');
            }
        }
        if (!['click', 'hover'].includes(action) || !args.uid) return finish({ decorated: false }, !args.uid && ['click', 'hover'].includes(action) ? 'missing_uid' : 'unsupported_action');
        try {
            const target = await targetFor(args.uid, context);
            if (!target) return finish({ decorated: false }, 'missing_geometry');

            await cue({
                action: 'cursor_move',
                viewVersion: getViewVersion(),
                target,
                durationMs: timing.cursorMoveMs
            });
            await pause(timing.cursorMoveMs + timing.hoverPauseMs);
            if (actionEpoch !== epoch) return finish({ decorated: true, cancelled: true }, 'epoch_changed');
            if (action === 'click') {
                await cue({
                    action: 'click',
                    viewVersion: getViewVersion(),
                    target,
                    durationMs: timing.clickPulseMs
                });
                await pause(timing.clickPulseMs);
                if (actionEpoch !== epoch) return finish({ decorated: true, cancelled: true }, 'epoch_changed');
            }
            return finish({ decorated: true, target });
        } catch {
            // Presentation must degrade independently from the real action.
            return finish({ decorated: false }, 'presentation_error');
        }
    }

    async function focus(uid, intent = 'emphasize', operationId) {
        const context = contextFor('focus', { uid }, operationId);
        return step(context, 'focus', async () => {
            const target = await targetFor(uid, context);
            const style = intent === 'text' ? 'marker' : intent === 'panel' ? 'spotlight' : 'outline';
            return publishCue({
                action: 'focus',
                operationId: context.operationId,
                style,
                viewVersion: getViewVersion(),
                target,
                durationMs: timing.focusTtlMs
            });
        });
    }

    async function clear(reason = 'replaced') {
        return step({ reason }, 'clear', () => publishCue({ action: 'clear', viewVersion: getViewVersion(), reason }));
    }

    function cancel(reason = 'customer_interrupted') {
        epoch += 1;
        emit('cancel', { reason, epoch, viewVersion: getViewVersion() });
        clear(reason).catch(() => {});
    }

    return { beforeAction, focus, clear, cancel };
}

export { DEFAULT_TIMING };
