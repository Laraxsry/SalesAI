import { RoutePlanningContextInput, RouteProposalInput } from '@repo/contracts';

const TERMINAL_OBLIGATION_STATUSES = new Set(['satisfied', 'declined', 'impossible']);
const EVIDENCE_REQUIRED_NODE_TYPES = new Set(['answer', 'demo']);
const EXPLICIT_SAFETY_ACTIONS = new Set(['click', 'fill', 'resolve']);

function rejection(code, detail = null) {
    return { code, detail };
}

/**
 * Deterministic policy boundary between an untrusted planner proposal and the
 * single-writer route state. It validates authority, grounding and durability;
 * it never mutates state and never executes browser actions.
 */
export function validateRouteProposal({ proposal, context, state }) {
    const parsedContext = RoutePlanningContextInput.safeParse(context);
    if (!parsedContext.success) {
        return { accepted: false, errors: [rejection('invalid_planning_context')] };
    }

    const parsedProposal = RouteProposalInput.safeParse(proposal);
    if (!parsedProposal.success) {
        return { accepted: false, errors: [rejection('invalid_route_proposal')] };
    }

    const normalized = parsedProposal.data;
    const planningContext = parsedContext.data;
    const errors = [];
    const currentNodes = new Map(planningContext.currentRoute.map((node) => [node.id, node]));
    const proposedIds = new Set(normalized.proposedNodes.map((node) => node.id));
    const obligationIds = new Set(Object.keys(planningContext.obligations));
    const preservedIds = new Set(normalized.preserveObligationIds);
    const evidenceIds = new Set(planningContext.evidenceIds);
    const allowedDemoUrls = new Set(planningContext.allowedDemoTargets.map((target) => target.pageUrl));
    const completedIds = new Set(planningContext.completedNodeIds);

    if (normalized.baseRevision !== planningContext.routeRevision
        || normalized.baseRevision !== state.routeRevision) {
        errors.push(rejection('stale_base_revision'));
    }
    if (normalized.planningGeneration !== planningContext.planningGeneration
        || normalized.planningGeneration !== state.planning.generation) {
        errors.push(rejection('stale_planning_generation'));
    }
    if (normalized.proposedNodes.length > planningContext.maxRouteNodes) {
        errors.push(rejection('route_too_long'));
    }

    for (const [id, runtime] of Object.entries(planningContext.obligations)) {
        if (runtime.requirement !== 'required_before_close'
            || TERMINAL_OBLIGATION_STATUSES.has(runtime.status)) continue;
        if (!preservedIds.has(id)) errors.push(rejection('required_obligation_not_preserved', id));
        if (!proposedIds.has(id)) errors.push(rejection('required_obligation_missing_from_route', id));
    }

    for (const id of normalized.preserveObligationIds) {
        if (!obligationIds.has(id)) errors.push(rejection('unknown_obligation', id));
    }
    for (const id of normalized.obsoleteOptionalNodeIds) {
        const node = currentNodes.get(id);
        if (!node) errors.push(rejection('unknown_obsolete_node', id));
        else if (obligationIds.has(id) || node.requirement === 'required_before_close') {
            errors.push(rejection('obligation_marked_obsolete', id));
        }
        if (proposedIds.has(id)) errors.push(rejection('obsolete_node_still_proposed', id));
    }

    for (const node of normalized.proposedNodes) {
        if (completedIds.has(node.id)) errors.push(rejection('completed_node_reintroduced', node.id));

        if (EVIDENCE_REQUIRED_NODE_TYPES.has(node.type)
            && (node.createdBy === 'planner' || node.createdBy === 'fallback')) {
            if (node.evidenceRefs.length === 0) {
                errors.push(rejection('ungrounded_claim_node', node.id));
            }
            for (const evidenceId of node.evidenceRefs) {
                if (!evidenceIds.has(evidenceId)) {
                    errors.push(rejection('unknown_evidence_reference', `${node.id}:${evidenceId}`));
                }
            }
        }

        if (node.type === 'demo') {
            const preferredUrl = node.pageIntent?.preferredUrl;
            if (!preferredUrl || !allowedDemoUrls.has(preferredUrl)) {
                errors.push(rejection('demo_target_not_allowed', node.id));
            }
        }

        for (const action of node.actions) {
            if (action.safety === 'destructive') {
                errors.push(rejection('destructive_action_rejected', node.id));
            } else if (EXPLICIT_SAFETY_ACTIONS.has(action.intent) && action.safety !== 'safe') {
                errors.push(rejection('interactive_action_not_explicitly_safe', node.id));
            }
        }
    }

    if (planningContext.activeQuestion
        && !normalized.proposedNodes.some((node) =>
            node.sourceQuestionId === planningContext.activeQuestion.id)) {
        errors.push(rejection('active_question_not_addressed', planningContext.activeQuestion.id));
    }

    return errors.length > 0
        ? { accepted: false, errors }
        : { accepted: true, proposal: normalized, errors: [] };
}
