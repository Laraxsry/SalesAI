/**
 * Holds a demo until the corresponding spoken answer turn has finished. One
 * pending demo is allowed; a new route or customer interruption cancels it.
 */
export function createAnswerFirstDemoCoordinator({ executor, onResult = () => {} }) {
    let pending = null;
    let running = false;
    let answerReady = false;

    function report(payload) {
        try {
            onResult(payload);
        } catch {
            // State/timeline adapters cannot break demo execution.
        }
    }

    async function answerDelivered() {
        if (running) {
            answerReady = true;
            return null;
        }
        if (!pending) return null;
        const scheduled = pending;
        pending = null;
        running = true;
        let result;
        try {
            result = await executor.execute(scheduled.node, scheduled.metadata);
        } catch (error) {
            result = { status: 'deferred', reason: error.message };
        } finally {
            running = false;
        }
        report({ ...scheduled, result });
        const continueWithPending = answerReady && pending;
        answerReady = false;
        if (continueWithPending) await answerDelivered();
        return result;
    }

    function schedule(node, metadata) {
        if (pending || running) executor.cancel('route_replaced');
        pending = { node, metadata };
        return { scheduled: true, nodeId: node.id };
    }

    function cancel(reason = 'customer_interrupted') {
        pending = null;
        answerReady = false;
        executor.cancel(reason);
    }

    return {
        schedule,
        answerDelivered,
        cancel,
        hasPending: () => Boolean(pending),
        isRunning: () => running
    };
}
