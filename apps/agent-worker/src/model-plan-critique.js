const DROPPABLE_TYPES = new Set(['check', 'demo']);
const ISSUE_CODES = new Set(['repetitive', 'irrelevant', 'unnecessary_demo']);

/** Turns a narrow, untrusted model critique into an advisory proposal revision. */
export function createModelPlanCritiqueInvocation({ complete, onAssessment = () => {} }) {
    if (typeof complete !== 'function') throw new TypeError('model completion is required');

    return async ({ model, proposal, context }) => {
        const candidates = proposal.proposedNodes.filter((node) =>
            DROPPABLE_TYPES.has(node.type)
            && ['optional', 'preferred'].includes(node.requirement)).slice(0, 20);
        if (candidates.length === 0) return proposal;

        const input = {
            activeQuestion: context.activeQuestion?.text ?? null,
            coveredTopics: context.memory.coveredClaims.map((claim) => ({
                topicId: claim.topicId, status: claim.highestStatus,
                proactiveMentionCount: claim.proactiveMentionCount
            })).slice(0, 30),
            candidates: candidates.map((node) => ({
                id: node.id, type: node.type, objective: node.objective.slice(0, 240),
                semanticTopicId: node.semanticIdentity?.topicId ?? null,
                hasEvidence: node.evidenceRefs.length > 0
            }))
        };
        const response = await complete({
            model,
            system: 'Review the candidate route for repetition and unnecessary steps. Only suggest dropping an optional candidate when strongly justified. Preserve direct answers, required obligations, and customer choice. Do not invent facts or identifiers.',
            messages: [{ role: 'user', content: JSON.stringify(input) }],
            responseFormat: {
                type: 'json_schema', json_schema: {
                    name: 'route_critique', strict: true,
                    schema: {
                        type: 'object', additionalProperties: false,
                        properties: {
                            dropNodeIds: { type: 'array', items: { type: 'string' } },
                            issueCode: { type: 'string', enum: [
                                'none', 'repetitive', 'irrelevant', 'unnecessary_demo'
                            ] }
                        },
                        required: ['dropNodeIds', 'issueCode']
                    }
                }
            }
        });
        const text = typeof response === 'string' ? response : response?.text;
        if (typeof text !== 'string' || text.length > 3000) {
            throw new TypeError('invalid model critique');
        }
        let critique;
        try { critique = JSON.parse(text); } catch {
            throw new TypeError('invalid model critique');
        }
        const ids = critique?.dropNodeIds;
        const allowedIds = new Set(candidates.map((node) => node.id));
        const byId = new Map(candidates.map((node) => [node.id, node]));
        if (!Array.isArray(ids) || ids.length > candidates.length
            || new Set(ids).size !== ids.length || ids.some((id) => !allowedIds.has(id))
            || (ids.length > 0 && !ISSUE_CODES.has(critique.issueCode))
            || (ids.length === 0 && critique.issueCode !== 'none')
            || (critique.issueCode === 'unnecessary_demo'
                && ids.some((id) => byId.get(id)?.type !== 'demo'))) {
            throw new TypeError('model critique selected unsafe nodes');
        }
        try {
            onAssessment({ issueCode: critique.issueCode, droppedNodeCount: ids.length });
        } catch {
            // Diagnostics never affect the reviewer result.
        }
        if (ids.length === 0) return proposal;
        const dropped = new Set(ids);
        return {
            ...proposal,
            proposedNodes: proposal.proposedNodes.filter((node) => !dropped.has(node.id))
        };
    };
}
