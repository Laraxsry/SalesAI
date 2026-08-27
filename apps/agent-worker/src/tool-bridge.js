/**
 * Wraps each tool's handler so the agent says a short, natural bridge line
 * while a genuinely slow lookup is still running — instead of leaving the
 * visitor in silence right after they asked a question.
 *
 * Mirrors `withToolCallMetrics` / `withPlaybookProgress`'s shape (map + spread
 * + wrap `handler`, return value and throw behavior untouched) so all three
 * compose in agent.js without knowing about each other.
 *
 * *** Why this is code and not a persona rule ***
 *
 * A model told "say something before you look things up" says it every single
 * time — including on a `retrieve()` Redis cache hit that returns in
 * milliseconds, where the bridge lands on top of its own answer. That is just
 * a new robotic tic in place of the old one. Only the runtime knows whether
 * there was actually a wait, so only the runtime can decide to fill it.
 *
 * The scheduling is the SDK's `RunContext.filler`, which is built for exactly
 * this and handles the two things a hand-rolled version gets wrong:
 *
 *  1. It dwells on `session.waitForIdle()` before speaking, so the bridge can
 *     never talk over the turn that called the tool. This works during a
 *     realtime tool call specifically because `_markGenerationDone()` fires
 *     BEFORE `await executeToolsTask.result` in agent_activity.js — the same
 *     window `silence-driver.js` cannot see, because `agentState` stays
 *     'speaking' throughout.
 *  2. After the tool returns, the SDK drains the speech queue before sending
 *     the tool output, so the real answer cannot overlap the bridge either.
 *
 * A `source` function returning a `SpeechHandle` is used as-is by the
 * scheduler; a plain string would go through `session.say()`, which throws
 * without a TTS model — and this agent is speech-to-speech, so there isn't
 * one. Returning `generateReply(...)` keeps the bridge in the agent's own
 * realtime voice.
 *
 * @param {Array<{name: string, description: string, parameters: object, handler: Function}>} toolDefs
 * @param {object} hooks
 * @param {string[]} hooks.slowTools  tool names eligible for a bridge
 * @param {(ctx: {step: number}) => string|null} hooks.buildInstructions
 *   what to say; returning null means stay quiet for this step
 * @param {(instructions: string) => object} hooks.speak  returns a SpeechHandle
 * @param {number} [hooks.delayMs=1200]     quiet dwell before the first bridge
 * @param {number} [hooks.intervalMs]       omit for at most one bridge
 * @param {number} [hooks.maxSteps=2]
 * @param {(info: {tool: string, step: number}) => void} [hooks.onBridge]
 * @param {(error: string, meta: object) => void} [hooks.onError]
 */
export function withToolBridge(
    toolDefs,
    {
        slowTools,
        buildInstructions,
        speak,
        delayMs = 1200,
        intervalMs,
        maxSteps = 2,
        onBridge = () => {},
        onError = () => {}
    }
) {
    // Only lookups. `click_element`/`scroll_page`/`navigate_to` are
    // mid-narration moves the model makes while it is already talking — the
    // same reasoning playbook-progress.js uses to refuse them as progress
    // signals. Bridging those would have the agent narrating its own
    // machinery, which is the exact complaint this change exists to fix.
    const eligible = new Set(slowTools);

    return toolDefs.map((toolDef) => ({
        ...toolDef,
        handler: async (...args) => {
            // `tool.execute(rawArguments, { ctx, toolCallId, abortSignal })` —
            // both peer decorators forward ...args, so ctx reaches us intact.
            const runCtx = args[1]?.ctx;
            if (!eligible.has(toolDef.name) || typeof runCtx?.filler !== 'function') {
                return toolDef.handler(...args);
            }

            return runCtx.filler(
                (step) => {
                    const instructions = buildInstructions({ step });
                    if (!instructions) return null;
                    try {
                        onBridge({ tool: toolDef.name, step });
                        return speak(instructions);
                    } catch (err) {
                        // generateReply throws synchronously once the session
                        // is closing. The scheduler calls this without a guard
                        // and swallows the throw further up, so without this
                        // catch the bridge would die silently and unlogged.
                        onError(err?.message ?? String(err), { tool: toolDef.name, step });
                        return null;
                    }
                },
                { delay: delayMs, ...(intervalMs ? { interval: intervalMs } : {}), maxSteps },
                () => toolDef.handler(...args)
            );
        }
    }));
}
