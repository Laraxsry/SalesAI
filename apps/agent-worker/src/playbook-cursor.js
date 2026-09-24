/**
 * The playbook's position, as plain JS state — a `currentIndex` and a `Set`
 * of satisfied step ids. This is deliberately not something the model ever
 * sees or reasons about (see md/backend/agent_flow.md, "neden hardcoded,
 * prompt değil"): a `while` loop over a `Set` cannot hallucinate, forget
 * where it is, or announce that it's moving to the next topic.
 *
 * A step can be satisfied out of order — a visitor who asks about step 4's
 * topic while step 2 is current gets step 4 marked done immediately; the
 * cursor simply skips it, silently, whenever it's eventually reached.
 *
 * @typedef {{ id:string, order:number, type?:'narrative'|'survey', url:string|null, directive:string,
 *             actions?:string[], survey?:object|null, mode:'important'|'situational'|'skip-if-no-answer' }} PlaybookNode
 *
 * @param {PlaybookNode[]} nodes already normalized (see normalizePlaybook in
 *   @repo/contracts) — sorted by order, densely numbered, blank steps dropped
 */
export function createPlaybookCursor(nodes) {
    let route = [...nodes];
    const satisfied = new Set();
    let currentIndex = 0;

    /** Moves past any step already satisfied, so `currentIndex` always points
     *  at the next thing actually left to do (or one-past-the-end). */
    function skipSatisfied() {
        while (currentIndex < route.length && satisfied.has(route[currentIndex].id)) {
            currentIndex += 1;
        }
    }
    skipSatisfied();

    return {
        current() {
            return route[currentIndex] ?? null;
        },

        /**
         * @param {string} nodeId
         * @param {'tool'|'advance_step'|'silence'|'answered'|'failed'} reason kept
         *   for callers' logging — the cursor itself doesn't branch on it
         * @returns {boolean} false if this step was already satisfied (the
         *   idempotence guard against, e.g., a duplicate advance_step call)
         */
        satisfy(nodeId, reason) { // eslint-disable-line no-unused-vars
            if (satisfied.has(nodeId)) return false;
            satisfied.add(nodeId);
            return true;
        },

        isSatisfied(nodeId) {
            return satisfied.has(nodeId);
        },

        /** Moves to the next not-yet-satisfied step. */
        advance() {
            currentIndex = Math.min(currentIndex + 1, route.length);
            skipSatisfied();
            return route[currentIndex] ?? null;
        },

        /** Replace pending steps after an accepted route revision. Completed IDs
         * remain satisfied; the model cannot replay them under a new position. */
        replace(nextNodes) {
            if (!Array.isArray(nextNodes) || nextNodes.some((node) =>
                !node || typeof node.id !== 'string')) {
                throw new TypeError('route nodes are required');
            }
            const ids = nextNodes.map((node) => node.id);
            if (new Set(ids).size !== ids.length) throw new TypeError('duplicate route node ID');
            route = [...nextNodes];
            currentIndex = 0;
            skipSatisfied();
            return route[currentIndex] ?? null;
        },

        /** Whether any step from here on (not yet satisfied) still needs a
         *  screen — the lookahead that decides whether to hide the tour when
         *  moving to a step with no url of its own, versus leaving it open
         *  because a later step will need it again. */
        anyRemainingUrl() {
            for (let i = currentIndex; i < route.length; i += 1) {
                const node = route[i];
                if (!satisfied.has(node.id) && node.url) return true;
            }
            return false;
        },

        get exhausted() {
            return currentIndex >= route.length;
        },

        snapshot() {
            return { index: currentIndex, total: route.length, satisfied: [...satisfied] };
        }
    };
}
