import { RoutePlanningContextInput } from '@repo/contracts';
import { validateRouteProposal } from './route-proposal-validator.js';
import { projectPlanningMemory } from './conversation-memory.js';

/**
 * Application service for route replanning. The planner proposes, the policy
 * validates, and only the store reducer commits a revision.
 */
export function createRoutePlanningService({
    store,
    planner,
    reviewers = null,
    validate = validateRouteProposal,
    onDecision = () => {},
    maxRouteNodes = 20,
    now = () => Date.now()
}) {
    function notify(decision) {
        try {
            onDecision(decision);
        } catch {
            // Observability remains outside the planning control path.
        }
    }

    return {
        async replan({ reason, activeQuestion = null, knowledge = null, allowedDemoTargets = [] }) {
            const planningStartedAt = now();
            const elapsed = () => Math.max(0, now() - planningStartedAt);
            store.dispatch({ type: 'PLANNING_STARTED', reason });
            const startedState = store.snapshot();
            const contextResult = RoutePlanningContextInput.safeParse({
                sessionId: startedState.sessionId,
                contractId: startedState.contractId,
                routeRevision: startedState.routeRevision,
                planningGeneration: startedState.planning.generation,
                reason,
                activeQuestion,
                knowledge,
                currentRoute: startedState.route,
                obligations: startedState.obligations,
                completedNodeIds: startedState.completedNodeIds,
                memory: projectPlanningMemory(startedState.memory),
                evidenceIds: [
                    ...new Set([
                        ...startedState.evidenceLedger,
                        ...(knowledge?.evidence ?? []).map((item) => item.evidenceId)
                    ])
                ],
                allowedDemoTargets,
                maxRouteNodes
            });
            if (!contextResult.success) {
                store.dispatch({
                    type: 'ROUTE_REVISION_REJECTED',
                    planningGeneration: startedState.planning.generation,
                    reason,
                    rejection: 'invalid_planning_context'
                });
                const decision = {
                    type: 'rejected',
                    reason: 'invalid_planning_context',
                    errors: contextResult.error.issues,
                    context: {
                        planningGeneration: startedState.planning.generation,
                        routeRevision: startedState.routeRevision,
                        reason
                    },
                    durationMs: elapsed()
                };
                notify(decision);
                return decision;
            }
            const context = contextResult.data;
            notify({ type: 'started', context, durationMs: 0 });

            let proposal;
            try {
                proposal = await planner.propose(context);
            } catch (error) {
                store.dispatch({
                    type: 'ROUTE_REVISION_REJECTED',
                    planningGeneration: context.planningGeneration,
                    reason,
                    rejection: 'planner_failed'
                });
                const decision = {
                    type: 'rejected', reason: 'planner_failed', error, context, durationMs: elapsed()
                };
                notify(decision);
                return decision;
            }

            const plannerProposal = proposal;
            let reviews = [];
            if (reviewers) {
                try {
                    const reviewed = await reviewers.review({ proposal, context });
                    proposal = reviewed.proposal;
                    reviews = reviewed.reviews;
                } catch {
                    // The reviewer layer is advisory and fail-open. The
                    // deterministic validator below still remains fail-closed.
                    reviews = [{ middlewareId: null, status: 'skipped_pipeline_error' }];
                }
            }

            const state = store.snapshot();
            let validation = validate({ proposal, context, state });
            if (!validation.accepted && proposal !== plannerProposal) {
                const plannerValidation = validate({ proposal: plannerProposal, context, state });
                if (plannerValidation.accepted) {
                    proposal = plannerProposal;
                    validation = plannerValidation;
                    reviews = [
                        ...reviews,
                        { middlewareId: null, status: 'reverted_by_policy' }
                    ];
                }
            }
            if (!validation.accepted) {
                const rejection = validation.errors[0]?.code ?? 'proposal_rejected';
                store.dispatch({
                    type: 'ROUTE_REVISION_REJECTED',
                    planningGeneration: context.planningGeneration,
                    reason,
                    rejection
                });
                const decision = {
                    type: 'rejected', reason: rejection, errors: validation.errors, reviews, context,
                    durationMs: elapsed()
                };
                notify(decision);
                return decision;
            }

            store.dispatch({
                type: 'ROUTE_REVISION_ACCEPTED',
                baseRevision: validation.proposal.baseRevision,
                planningGeneration: validation.proposal.planningGeneration,
                reason: validation.proposal.reason,
                nodes: validation.proposal.proposedNodes
            });
            const current = store.snapshot();
            const accepted = current.routeRevision === context.routeRevision + 1
                && current.planning.generation === context.planningGeneration;
            const decision = accepted
                ? {
                    type: 'accepted', proposal: validation.proposal, reviews, context, state: current,
                    durationMs: elapsed()
                }
                : {
                    type: 'ignored', reason: 'superseded_planning_generation', reviews, context,
                    state: current, durationMs: elapsed()
                };
            notify(decision);
            return decision;
        }
    };
}
