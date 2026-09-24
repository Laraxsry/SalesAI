import { AnalystProposalInput, RouteProposalInput } from '@repo/contracts';
import { createAnalystProposalFactory } from './proposal-factory.js';

/** Adapts the existing plan reviewer port without granting it state authority. */
export function createRouteCriticAnalystAdapter({
    reviewer,
    version = '1.0.0',
    proposalFactory = createAnalystProposalFactory()
}) {
    if (!reviewer || typeof reviewer.id !== 'string' || typeof reviewer.review !== 'function') {
        throw new TypeError('route critic adapter requires a plan reviewer');
    }

    const analyst = {
        id: reviewer.id,
        version,
        timeoutMs: reviewer.timeoutMs,
        contextNeeds: ['route_proposal', 'planning_context'],
        enabled(executionContext) {
            return reviewer.enabled ? Boolean(reviewer.enabled(executionContext.planningContext)) : true;
        },
        supports(event) {
            return event.type === 'route_proposed';
        },
        async analyze(context) {
            const original = RouteProposalInput.safeParse(context.routeProposal);
            if (!original.success || !context.planningContext) return null;
            const revised = RouteProposalInput.parse(await reviewer.review(
                original.data,
                context.planningContext
            ));
            const revisedIds = new Set(revised.proposedNodes.map((node) => node.id));
            const removeNodeIds = original.data.proposedNodes
                .filter((node) => !revisedIds.has(node.id))
                .map((node) => node.id);
            if (removeNodeIds.length === 0) return null;

            return AnalystProposalInput.parse(proposalFactory({
                analyst,
                event: context.event,
                context,
                proposalType: 'route_critique',
                payload: {
                    confidence: 1,
                    value: { issueCodes: [], removeNodeIds }
                }
            }));
        }
    };
    return Object.freeze(analyst);
}
