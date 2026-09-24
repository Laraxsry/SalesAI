import { ConversationEventInput } from '@repo/contracts';

class AnalystTimeoutError extends Error {
    constructor(analystId, timeoutMs) {
        super(`analyst ${analystId} timed out after ${timeoutMs}ms`);
        this.name = 'AnalystTimeoutError';
    }
}

class AnalystCancelledError extends Error {
    constructor() {
        super('analyst run cancelled');
        this.name = 'AnalystCancelledError';
    }
}

async function runWithTimeout({ analyst, context, timeoutMs, parentSignal }) {
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener('abort', abort, { once: true });

    let timer;
    let rejectOnAbort;
    try {
        const aborted = new Promise((_, reject) => {
            rejectOnAbort = () => reject(
                controller.signal.reason instanceof Error
                    ? controller.signal.reason
                    : new AnalystCancelledError()
            );
            controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
            if (controller.signal.aborted) rejectOnAbort();
        });
        return await Promise.race([
            Promise.resolve().then(() => analyst.analyze(context, { signal: controller.signal })),
            aborted,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new AnalystTimeoutError(analyst.id, timeoutMs);
                    controller.abort(error);
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', rejectOnAbort);
        parentSignal?.removeEventListener('abort', abort);
    }
}

export function createAnalystRunner({
    registry,
    contextProjector,
    proposalValidator,
    telemetry,
    modelRouter,
    maxConcurrency = 3,
    defaultTimeoutMs = 800,
    now = () => Date.now()
}) {
    if (!registry || !contextProjector || !proposalValidator) {
        throw new TypeError('analyst runner requires registry, contextProjector and proposalValidator');
    }
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 20) {
        throw new TypeError('maxConcurrency must be between 1 and 20');
    }

    async function executeAnalyst({ analyst, event, executionContext, getCurrentContext, signal }) {
        const startedAt = now();
        const modelRoute = modelRouter?.resolve(analyst.id) ?? null;
        const report = (status, extra = {}) => {
            telemetry?.record({
                analystId: analyst.id,
                analystVersion: analyst.version,
                eventType: event.type,
                status,
                durationMs: Math.max(0, now() - startedAt),
                model: modelRoute?.model,
                ...extra
            });
        };

        try {
            if (signal?.aborted) {
                report('cancelled');
                return { analystId: analyst.id, status: 'cancelled' };
            }
            let enabled = true;
            try {
                enabled = analyst.enabled ? Boolean(analyst.enabled(executionContext)) : true;
            } catch {
                enabled = false;
            }
            if (!enabled) {
                report('skipped_disabled');
                return { analystId: analyst.id, status: 'skipped_disabled' };
            }

            const projected = contextProjector.project({ analyst, event, executionContext });
            const proposal = await runWithTimeout({
                analyst,
                context: Object.freeze({ ...projected, modelRoute }),
                timeoutMs: analyst.timeoutMs ?? modelRoute?.timeoutMs ?? defaultTimeoutMs,
                parentSignal: signal
            });
            if (!proposal) {
                report('no_proposal');
                return { analystId: analyst.id, status: 'no_proposal' };
            }

            const latest = getCurrentContext();
            const validation = proposalValidator.validateAndReserve({
                proposal,
                event,
                currentContext: {
                    memoryRevision: latest.memory?.revision ?? 0,
                    routeRevision: latest.routeRevision ?? event.routeRevision,
                    turnIndex: latest.turnIndex ?? event.turnIndex
                }
            });
            if (!validation.accepted) {
                const reason = validation.errors[0]?.code ?? 'rejected';
                report('rejected', { reason });
                return { analystId: analyst.id, status: 'rejected', errors: validation.errors };
            }
            report('accepted', { proposalType: validation.proposal.proposalType });
            return { analystId: analyst.id, status: 'accepted', proposal: validation.proposal };
        } catch (error) {
            const status = error instanceof AnalystTimeoutError
                ? 'timeout'
                : error instanceof AnalystCancelledError || signal?.aborted ? 'cancelled' : 'error';
            report(status);
            return { analystId: analyst.id, status, error };
        }
    }

    return Object.freeze({
        async run({ event: eventInput, executionContext = {}, getCurrentContext, signal } = {}) {
            const event = ConversationEventInput.parse(eventInput);
            const analysts = registry.matching(event);
            const current = typeof getCurrentContext === 'function'
                ? getCurrentContext
                : () => executionContext;
            const results = new Array(analysts.length);
            let cursor = 0;

            async function worker() {
                while (cursor < analysts.length) {
                    const index = cursor++;
                    results[index] = await executeAnalyst({
                        analyst: analysts[index],
                        event,
                        executionContext,
                        getCurrentContext: current,
                        signal
                    });
                }
            }

            await Promise.all(Array.from(
                { length: Math.min(maxConcurrency, analysts.length) },
                () => worker()
            ));
            return results;
        }
    });
}
