/**
 * Wraps each tool's handler so a tool result can complete a playbook node —
 * but only when that tool IS the node's stated goal. Mirrors
 * `withToolCallMetrics`'s shape exactly (map + spread + wrap `handler`,
 * return value and throw behavior untouched) so it composes cleanly with it
 * in agent.js without either decorator needing to know the other exists.
 *
 * Why so narrow: `navigate_to` and `scroll_page` are mid-narration moves, not
 * completions — the model uses them constantly while still explaining a page.
 * Treating any of them as progress would race the presentation past a node it
 * has barely started. The only tool call that unambiguously means "this
 * node's one concrete action happened" is `click_element` succeeding on a
 * node that actually asked for a click (`attach` is set) .
 *
 * @param {Array<{name: string, description: string, parameters: object, handler: Function}>} toolDefs
 * @param {{ currentNode: () => ({attach?: string|null}|null), onGoalReached: (toolName: string) => void }} hooks
 */
export function withPlaybookProgress(toolDefs, { currentNode, onGoalReached }) {
    return toolDefs.map((toolDef) => ({
        ...toolDef,
        handler: async (...args) => {
            const result = await toolDef.handler(...args);
            if (toolDef.name === 'click_element' && result?.ok) {
                const node = currentNode();
                if (node?.attach) onGoalReached(toolDef.name);
            }
            return result;
        }
    }));
}
