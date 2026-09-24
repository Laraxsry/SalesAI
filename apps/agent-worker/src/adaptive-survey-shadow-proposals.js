import { SurveyProposalInput } from '@repo/contracts';
import { evaluateSurveyProposal } from './adaptive-survey-gate.js';

/** Evaluates a real-shaped proposal without dispatching or presenting it. */
export function createAdaptiveSurveyShadowProposalService({
    store, planner, knownFactResolver, policy, fields,
    onDecision = () => {}, canEvaluate = () => true,
    maxProposalsPerSession = 3
}) {
    if (!store?.snapshot || !planner?.propose || !knownFactResolver?.resolve
        || !Array.isArray(fields)) {
        throw new TypeError('shadow proposal service requires state, planner, facts and fields');
    }
    const attemptedKeys = new Set();
    let attempts = 0;
    return {
        async evaluateCandidate(questionKey) {
            if (!canEvaluate() || attempts >= maxProposalsPerSession
                || attemptedKeys.has(questionKey)) return null;
            const field = fields.find((item) => item.key === questionKey
                && item.importance !== 'do_not_ask');
            if (!field) return null;
            attemptedKeys.add(questionKey);
            attempts++;
            const before = store.snapshot();
            let proposal;
            try {
                proposal = await planner.propose({ field,
                    routeRevision: before.routeRevision,
                    epoch: before.adaptiveSurvey.epoch,
                    turnIndex: before.memory.turnIndex });
            } catch { proposal = null; }
            const parsed = SurveyProposalInput.safeParse(proposal);
            const beforeLookup = store.snapshot();
            const initialFact = JSON.stringify(beforeLookup.memory.discoveredFacts?.[questionKey]);
            const initialQuestion = JSON.stringify(beforeLookup.memory.askedQuestions?.[questionKey]);
            let resolution;
            try {
                resolution = await knownFactResolver.resolve({
                    key: questionKey, memory: store.snapshot().memory
                });
            } catch {
                resolution = { key: questionKey, status: 'unavailable', fact: null,
                    candidates: [], reason: 'fact_resolver_failed' };
            }
            const latest = store.snapshot();
            let decision;
            if (!canEvaluate() || latest.memory.turnIndex !== before.memory.turnIndex
                || latest.routeRevision !== before.routeRevision
                || latest.adaptiveSurvey.epoch !== before.adaptiveSurvey.epoch
                || JSON.stringify(latest.memory.discoveredFacts?.[questionKey]) !== initialFact
                || JSON.stringify(latest.memory.askedQuestions?.[questionKey]) !== initialQuestion) {
                decision = { status: 'ignored', reason: 'stale_shadow_context' };
                attemptedKeys.delete(questionKey);
            } else if (!parsed.success || parsed.data.questionKey !== questionKey) {
                decision = { status: 'rejected', reason: 'invalid_shadow_proposal' };
            } else {
                decision = evaluateSurveyProposal({
                    proposal: parsed.data, policy, fieldDefinitions: fields,
                    factResolution: resolution, memory: latest.memory,
                    runtime: {
                        routeRevision: latest.routeRevision,
                        epoch: latest.adaptiveSurvey.epoch,
                        activeSurveyId: latest.adaptiveSurvey.activeSurveyId,
                        shownCount: latest.adaptiveSurvey.shownCount,
                        lastSurveyTurn: latest.adaptiveSurvey.lastOpenedTurn
                    },
                    hasOpenCustomerQuestion: latest.openQuestions.length > 0
                });
            }
            const result = { questionKey, status: decision.status, reason: decision.reason,
                turnIndex: before.memory.turnIndex,
                proposalId: parsed.success ? parsed.data.proposalId : null };
            try { onDecision(result); } catch { /* shadow telemetry only */ }
            return result;
        }
    };
}
