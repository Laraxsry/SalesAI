/**
 * Detects the SDK's own directive-less auto-follow-up turn — the exact
 * mechanism behind a live-observed bug (md/backend/playbook_session_log.md):
 * after any tool call, `@livekit/agents` (agent_activity.ts:~3987) starts a
 * second speech turn with NO per-response `instructions`, only the base
 * system prompt. When the turn that triggered it called nothing but
 * `advance_step` — a tool whose entire job is bookkeeping, with nothing to
 * say — that follow-up has no topic to draw from and falls back on whatever
 * was last genuinely said, verbatim, node after node.
 *
 * Pure and SDK-agnostic on purpose (same shape as silence-driver.js /
 * tool-metrics.js / session-timeline.js in this directory): takes a plain
 * object shaped like the SDK's `SpeechCreatedEvent`, returns a boolean, never
 * throws. `agent.js` is the only place that touches the real
 * `AgentSessionEventTypes.SpeechCreated` event; this is what decides what to
 * do once it has one.
 *
 * *** WHY THIS MUST STAY THIS NARROW ***
 * The same auto-follow-up mechanism also fires after `search_knowledge` —
 * and THAT follow-up is the actual RAG answer, not noise. Suppressing every
 * `source:'tool_response'` turn would silence the agent's real answers along
 * with the empty ones. The only safe signal is: every tool called in the
 * turn that triggered this follow-up was `advance_step`, and nothing else.
 *
 * @param {{
 *   source?: string,
 *   speechHandle?: { parent?: { chatItems?: Array<{ type: string, name?: string }> } }
 * }} event a SpeechCreatedEvent-shaped object
 * @returns {boolean}
 */
export function isDirectivelessAdvanceStepFollowup(event) {
    if (event?.source !== 'tool_response') return false;
    const calls = event.speechHandle?.parent?.chatItems?.filter((item) => item.type === 'function_call') ?? [];
    return calls.length > 0 && calls.every((call) => call.name === 'advance_step');
}
