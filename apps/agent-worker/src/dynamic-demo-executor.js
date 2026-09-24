import { DynamicPlaybookNodeInput } from '@repo/contracts';

const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End']);
const INTERACTIVE_INTENTS = new Set(['click']);

/**
 * Executes one accepted demo node through existing browser/navigation ports.
 * It never talks to Chrome MCP directly and never accepts persisted UIDs.
 */
export function createDynamicDemoExecutor({
    navigation,
    browser,
    resolveTarget,
    isCurrent = () => true,
    onEvent = () => {},
    maxTargetScrolls = 2,
    now = () => Date.now()
}) {
    let epoch = 0;

    function emit(event, meta = {}) {
        try {
            onEvent(event, meta);
        } catch {
            // Execution observability cannot affect the browser path.
        }
    }

    function cancel(reason = 'customer_interrupted') {
        epoch += 1;
        emit('cancelled', { reason, epoch });
    }

    function guard(token, execution) {
        if (token !== epoch) return 'cancelled';
        if (!isCurrent(execution)) return 'stale_route';
        return null;
    }

    async function observe(execution) {
        const result = await browser.observe();
        if (!result?.ok || typeof result.snapshot !== 'string') {
            throw new Error(result?.error || 'browser_snapshot_failed');
        }
        emit('snapshot', {
            nodeId: execution.nodeId,
            routeRevision: execution.routeRevision,
            url: result.url ?? null
        });
        return result;
    }

    async function resolveAcrossViewport(action, firstSnapshot, execution, token) {
        let snapshot = firstSnapshot;
        for (let attempt = 0; attempt <= maxTargetScrolls; attempt++) {
            const resolved = resolveTarget(snapshot.snapshot, {
                target: action.target,
                intent: action.intent
            });
            if (resolved.ok || resolved.reason === 'ambiguous_target') return resolved;
            if (attempt === maxTargetScrolls) return resolved;
            const stopped = guard(token, execution);
            if (stopped) return { ok: false, reason: stopped };
            const scrolled = await browser.perform('pressKey', { key: 'PageDown' });
            if (!scrolled?.ok) return { ok: false, reason: 'target_scroll_failed' };
            snapshot = await observe(execution);
        }
        return { ok: false, reason: 'target_not_found' };
    }

    async function execute(rawNode, metadata) {
        const startedAt = now();
        const parsed = DynamicPlaybookNodeInput.safeParse(rawNode);
        if (!parsed.success || parsed.data.type !== 'demo') {
            return { status: 'failed', reason: 'invalid_demo_node' };
        }
        const node = parsed.data;
        const execution = {
            nodeId: node.id,
            routeRevision: metadata.routeRevision,
            planningGeneration: metadata.planningGeneration
        };
        const token = epoch;

        try {
            const stoppedBeforeNavigation = guard(token, execution);
            if (stoppedBeforeNavigation) return { status: 'cancelled', reason: stoppedBeforeNavigation };
            emit('started', { ...execution, actionCount: node.actions.length });
            const targetUrl = node.pageIntent?.preferredUrl;
            if (!targetUrl) return { status: 'failed', reason: 'missing_demo_url' };

            const navigated = await navigation.ensureAt(targetUrl);
            if (!navigated?.ok) {
                return { status: 'deferred', reason: navigated?.error || 'navigation_failed' };
            }
            const stoppedAfterNavigation = guard(token, execution);
            if (stoppedAfterNavigation) {
                return { status: 'cancelled', reason: stoppedAfterNavigation };
            }
            let snapshot = await observe(execution);

            for (const action of node.actions) {
                const stopped = guard(token, execution);
                if (stopped) return { status: 'cancelled', reason: stopped };
                if (action.safety === 'destructive') {
                    return { status: 'failed', reason: 'destructive_action_rejected' };
                }
                if (INTERACTIVE_INTENTS.has(action.intent) && action.safety !== 'safe') {
                    return { status: 'failed', reason: 'interactive_action_not_explicitly_safe' };
                }
                if (action.intent === 'fill' || action.intent === 'navigate') {
                    return { status: 'failed', reason: `unsupported_demo_action:${action.intent}` };
                }
                if (action.intent === 'scroll' && SCROLL_KEYS.has(action.target)) {
                    const result = await browser.perform('pressKey', { key: action.target });
                    if (!result?.ok) return { status: 'deferred', reason: 'scroll_failed' };
                    snapshot = await observe(execution);
                    continue;
                }

                const resolved = await resolveAcrossViewport(action, snapshot, execution, token);
                if (!resolved.ok) return { status: 'deferred', reason: resolved.reason };
                const result = action.intent === 'click'
                    ? await browser.perform('click', { uid: resolved.uid })
                    : await browser.focus(resolved.uid, resolved.role === 'heading' ? 'text' : 'emphasize');
                if (!result?.ok) {
                    return { status: 'deferred', reason: result?.error || `${action.intent}_failed` };
                }
                emit('action', {
                    ...execution,
                    intent: action.intent,
                    target: action.target,
                    resolvedRole: resolved.role
                });
                if (action.intent === 'click') snapshot = await observe(execution);
            }

            const result = { status: 'completed', durationMs: Math.max(0, now() - startedAt) };
            emit('completed', { ...execution, ...result });
            return result;
        } catch (error) {
            const result = { status: 'deferred', reason: error.message };
            emit('failed', { ...execution, ...result, durationMs: Math.max(0, now() - startedAt) });
            return result;
        }
    }

    return { execute, cancel };
}
