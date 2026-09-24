/**
 * A narrow model planner: the model may prioritize grounded candidates, but
 * cannot invent evidence, URLs, browser actions, or mandatory obligations.
 */
export function createModelRoutePlanner({ complete, candidates }) {
    if (typeof complete !== 'function' || typeof candidates?.propose !== 'function') {
        throw new TypeError('model completion and candidate planner are required');
    }

    return {
        async propose(context) {
            const baseline = await candidates.propose(context);
            const closingIds = new Set(baseline.preserveObligationIds);
            const selectable = baseline.proposedNodes.filter((node) => !closingIds.has(node.id));
            if (selectable.length === 0) return baseline;

            const input = {
                question: context.activeQuestion?.text ?? null,
                knowledgeStatus: context.knowledge?.status ?? null,
                coveredTopics: context.memory.coveredClaims.map((claim) => ({
                    topicId: claim.topicId, status: claim.highestStatus,
                    proactiveMentionCount: claim.proactiveMentionCount
                })).slice(0, 30),
                declinedTopics: context.memory.declinedTopics.slice(0, 30),
                candidates: selectable.map((node) => ({
                    id: node.id, type: node.type, objective: node.objective,
                    hasEvidence: node.evidenceRefs.length > 0,
                    hasDemoTarget: Boolean(node.pageIntent?.preferredUrl)
                }))
            };
            const result = await complete({
                system: 'Select the next safe sales-conversation steps from supplied candidate IDs only. Answer an active customer question before promotion. Avoid repetition and unnecessary demos. Never invent IDs, URLs, evidence, actions or facts.',
                messages: [{ role: 'user', content: JSON.stringify(input) }],
                responseFormat: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'route_selection', strict: true,
                        schema: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                selectedNodeIds: { type: 'array', items: { type: 'string' } }
                            },
                            required: ['selectedNodeIds']
                        }
                    }
                }
            });
            const text = typeof result === 'string' ? result : result?.text;
            if (typeof text !== 'string' || text.length > 4000) {
                throw new TypeError('invalid model route selection');
            }
            let selection;
            try { selection = JSON.parse(text); } catch {
                throw new TypeError('invalid model route selection');
            }
            const ids = selection?.selectedNodeIds;
            const choices = new Map(selectable.map((node) => [node.id, node]));
            if (!Array.isArray(ids) || ids.length === 0 || ids.length > selectable.length
                || new Set(ids).size !== ids.length || ids.some((id) => !choices.has(id))) {
                throw new TypeError('model selected unknown or duplicate route nodes');
            }
            const requiredAnswer = selectable.find((node) => node.type === 'answer');
            const requiredGap = selectable.find((node) => ['ask', 'handoff'].includes(node.type));
            if ((requiredAnswer && ids[0] !== requiredAnswer.id)
                || (requiredGap && ids[0] !== requiredGap.id)) {
                throw new TypeError('model did not prioritize the customer response');
            }
            return {
                ...baseline,
                proposedNodes: [
                    ...ids.map((id) => ({ ...choices.get(id), createdBy: 'planner' })),
                    ...baseline.proposedNodes.filter((node) => closingIds.has(node.id))
                ]
            };
        }
    };
}
