import {
    ConversationActivity,
    ConversationPhase,
    DynamicPlaybookRuntimeStateInput,
    SurveyProposalInput
} from '@repo/contracts';
import { reduceConversationMemory } from './conversation-memory.js';

const TERMINAL_OBLIGATION_STATUSES = new Set(['satisfied', 'declined', 'impossible']);

const OBLIGATION_TRANSITIONS = {
    pending: new Set(['active', 'deferred', 'satisfied', 'declined', 'impossible']),
    deferred: new Set(['active', 'satisfied', 'declined', 'impossible']),
    active: new Set(['deferred', 'satisfied', 'declined', 'impossible']),
    satisfied: new Set(),
    declined: new Set(),
    impossible: new Set()
};

function addUnique(values, value) {
    return values.includes(value) ? values : [...values, value];
}

function removeValue(values, value) {
    return values.includes(value) ? values.filter((candidate) => candidate !== value) : values;
}

/**
 * Creates the canonical session-owned state from an immutable compiled
 * contract snapshot. The persisted playbook is never re-read by this module.
 *
 * @param {{sessionId:string, contract:object}} input
 */
export function createDynamicPlaybookState({ sessionId, contract }) {
    const obligations = Object.fromEntries(contract.obligations.map((obligation) => [
        obligation.id,
        {
            requirement: obligation.requirement,
            status: 'pending',
            attempts: 0,
            completionEvidence: []
        }
    ]));

    return DynamicPlaybookRuntimeStateInput.parse({
        sessionId,
        contractId: contract.id,
        routeRevision: 0,
        conversationPhase: 'opening',
        activity: 'listening',
        route: contract.nodes,
        obligations
    });
}

/**
 * Pure, single-writer reducer for the dynamic playbook domain. Unknown or
 * invalid events are no-ops; adapters may log those decisions without making
 * the domain reducer depend on a logger.
 *
 * @param {object} state
 * @param {object} event
 */
function reduceCoreDynamicPlaybookState(state, event) {
    switch (event?.type) {
        case 'PHASE_CHANGED':
            if (!ConversationPhase.safeParse(event.phase).success) return state;
            return DynamicPlaybookRuntimeStateInput.parse({
                ...state,
                conversationPhase: event.phase
            });

        case 'ACTIVITY_CHANGED':
            if (!ConversationActivity.safeParse(event.activity).success) return state;
            return DynamicPlaybookRuntimeStateInput.parse({
                ...state,
                activity: event.activity
            });

        case 'NODE_STARTED':
            if (!state.route.some((node) => node.id === event.nodeId)) return state;
            return {
                ...state,
                activeNodeId: event.nodeId
            };

        case 'NODE_COMPLETED':
            if (!state.route.some((node) => node.id === event.nodeId)) return state;
            return {
                ...state,
                activeNodeId: state.activeNodeId === event.nodeId ? null : state.activeNodeId,
                completedNodeIds: addUnique(state.completedNodeIds, event.nodeId),
                skippedNodeIds: removeValue(state.skippedNodeIds, event.nodeId)
            };

        case 'NODE_SKIPPED':
            if (!state.route.some((node) => node.id === event.nodeId)) return state;
            return {
                ...state,
                activeNodeId: state.activeNodeId === event.nodeId ? null : state.activeNodeId,
                skippedNodeIds: addUnique(state.skippedNodeIds, event.nodeId)
            };

        case 'NODE_DEFERRED':
            if (!state.route.some((node) => node.id === event.nodeId)) return state;
            return {
                ...state,
                activeNodeId: state.activeNodeId === event.nodeId ? null : state.activeNodeId
            };

        case 'PLANNING_STARTED':
            return {
                ...state,
                activity: 'planning',
                planning: {
                    status: 'planning',
                    generation: state.planning.generation + 1,
                    lastReason: event.reason ?? null,
                    lastRejection: null
                }
            };

        case 'ROUTE_REVISION_ACCEPTED': {
            if (event.planningGeneration !== state.planning.generation) return state;
            if (event.baseRevision !== state.routeRevision) {
                return {
                    ...state,
                    activity: 'listening',
                    planning: {
                        ...state.planning,
                        status: 'rejected',
                        lastReason: event.reason ?? state.planning.lastReason,
                        lastRejection: 'stale_base_revision'
                    }
                };
            }

            const nextRevision = state.routeRevision + 1;
            const nextState = DynamicPlaybookRuntimeStateInput.safeParse({
                ...state,
                routeRevision: nextRevision,
                activeNodeId: null,
                route: event.nodes,
                adaptiveSurvey: {
                    ...state.adaptiveSurvey,
                    epoch: state.adaptiveSurvey.epoch + 1,
                    approvedProposal: null,
                    lastDecision: null
                },
                activity: 'listening',
                planning: {
                    ...state.planning,
                    status: 'accepted',
                    lastReason: event.reason ?? state.planning.lastReason,
                    lastRejection: null
                }
            });
            if (nextState.success) return nextState.data;
            return {
                ...state,
                activity: 'listening',
                planning: {
                    ...state.planning,
                    status: 'rejected',
                    lastReason: event.reason ?? state.planning.lastReason,
                    lastRejection: 'invalid_route_revision'
                }
            };
        }

        case 'ROUTE_REVISION_REJECTED':
            if (event.planningGeneration !== state.planning.generation) return state;
            return {
                ...state,
                activity: 'listening',
                planning: {
                    ...state.planning,
                    status: 'rejected',
                    lastReason: event.reason ?? state.planning.lastReason,
                    lastRejection: event.rejection ?? 'rejected'
                }
            };

        case 'OBLIGATION_STATUS_CHANGED': {
            const obligation = state.obligations[event.obligationId];
            if (!obligation || obligation.status === event.status) return state;
            if (!OBLIGATION_TRANSITIONS[obligation.status]?.has(event.status)) return state;

            const terminal = TERMINAL_OBLIGATION_STATUSES.has(event.status);
            if (terminal && (typeof event.evidence !== 'string' || !event.evidence.trim())) return state;

            const evidence = typeof event.evidence === 'string' && event.evidence.trim()
                ? addUnique(obligation.completionEvidence, event.evidence.trim())
                : obligation.completionEvidence;

            return {
                ...state,
                obligations: {
                    ...state.obligations,
                    [event.obligationId]: {
                        ...obligation,
                        status: event.status,
                        attempts: event.status === 'active' ? obligation.attempts + 1 : obligation.attempts,
                        completionEvidence: evidence
                    }
                }
            };
        }

        case 'QUESTION_OPENED':
            return {
                ...state,
                openQuestions: addUnique(state.openQuestions, event.questionId)
            };

        case 'QUESTION_RESOLVED':
            return {
                ...state,
                openQuestions: removeValue(state.openQuestions, event.questionId)
            };

        case 'CONCERN_OPENED':
            return {
                ...state,
                openConcerns: addUnique(state.openConcerns, event.concernId)
            };

        case 'CONCERN_RESOLVED':
            return {
                ...state,
                openConcerns: removeValue(state.openConcerns, event.concernId)
            };

        case 'EVIDENCE_RECORDED':
            if (typeof event.evidenceId !== 'string' || !event.evidenceId.trim()) return state;
            return {
                ...state,
                evidenceLedger: addUnique(state.evidenceLedger, event.evidenceId.trim())
            };

        case 'CAPABILITY_REQUEST_RECORDED':
            if (typeof event.requestId !== 'string' || !event.requestId.trim()) return state;
            return {
                ...state,
                capabilityRequests: addUnique(state.capabilityRequests, event.requestId.trim())
            };

        case 'SURVEY_PROPOSAL_REVIEWED': {
            const parsedProposal = SurveyProposalInput.safeParse(event.proposal);
            if (!parsedProposal.success) return state;
            const proposal = parsedProposal.data;
            const decision = event.decision;
            if (!proposal || proposal.baseRevision !== state.routeRevision
                || proposal.epoch !== state.adaptiveSurvey.epoch) return state;
            if (!['approved', 'rejected', 'deferred', 'verify_voice'].includes(decision?.status)) {
                return state;
            }
            return {
                ...state,
                adaptiveSurvey: {
                    ...state.adaptiveSurvey,
                    approvedProposal: decision.status === 'approved'
                        && decision.channel === 'survey'
                        ? proposal
                        : null,
                    lastDecision: {
                        proposalId: proposal.proposalId,
                        status: decision.status,
                        reason: decision.reason,
                        channel: decision.channel ?? null
                    }
                }
            };
        }

        case 'ADAPTIVE_SURVEY_OPENED': {
            const proposal = state.adaptiveSurvey.approvedProposal;
            if (!proposal || state.adaptiveSurvey.activeSurveyId
                || event.proposalId !== proposal.proposalId) return state;
            return {
                ...state,
                adaptiveSurvey: {
                    ...state.adaptiveSurvey,
                    activeSurveyId: proposal.proposalId,
                    shownCount: state.adaptiveSurvey.shownCount + 1,
                    lastOpenedTurn: state.memory.turnIndex
                }
            };
        }

        case 'ADAPTIVE_SURVEY_CLOSED':
            if (!state.adaptiveSurvey.activeSurveyId
                || event.proposalId !== state.adaptiveSurvey.activeSurveyId) return state;
            return {
                ...state,
                adaptiveSurvey: {
                    ...state.adaptiveSurvey,
                    activeSurveyId: null,
                    approvedProposal: null
                }
            };

        case 'SESSION_COMPLETED':
            if (Object.values(state.obligations).some((obligation) =>
                obligation.requirement === 'required_before_close'
                && !TERMINAL_OBLIGATION_STATUSES.has(obligation.status)
            )) return state;
            if (state.openQuestions.length > 0 || state.openConcerns.length > 0) return state;
            return {
                ...state,
                conversationPhase: 'complete',
                activity: 'waiting',
                activeNodeId: null
            };

        default:
            return state;
    }
}

export function reduceDynamicPlaybookState(state, event) {
    const coreState = reduceCoreDynamicPlaybookState(state, event);
    const memory = reduceConversationMemory(coreState.memory, event, {
        route: coreState.route,
        routeRevision: coreState.routeRevision
    });
    return memory === coreState.memory ? coreState : { ...coreState, memory };
}

/**
 * Read-only guard used by orchestration before proposing a natural close.
 * Declined/impossible obligations are terminal evidence, not reasons to trap
 * a visitor in the conversation.
 */
export function canCompleteDynamicPlaybook(state) {
    if (state.openQuestions.length > 0 || state.openConcerns.length > 0) return false;
    return Object.values(state.obligations).every((obligation) =>
        obligation.requirement !== 'required_before_close'
        || TERMINAL_OBLIGATION_STATUSES.has(obligation.status)
    );
}
