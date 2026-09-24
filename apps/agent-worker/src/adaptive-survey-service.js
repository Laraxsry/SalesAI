import { evaluateSurveyProposal } from './adaptive-survey-gate.js';

/** Application service: resolve facts, gate proposal, then ask the reducer to record the decision. */
export function createAdaptiveSurveyService({
    store,
    knownFactResolver,
    policy = {},
    fieldDefinitions = [],
    reviewers = null,
    evaluate = evaluateSurveyProposal,
    onDecision = () => {}
}) {
    if (!store || typeof store.snapshot !== 'function' || typeof store.dispatch !== 'function') {
        throw new TypeError('dynamic playbook store is required');
    }
    if (!knownFactResolver || typeof knownFactResolver.resolve !== 'function') {
        throw new TypeError('known fact resolver is required');
    }

    return {
        async review(proposal, { factContext = {}, hasOpenCustomerQuestion } = {}) {
            const beforeLookup = store.snapshot();
            let factResolution;
            try {
                factResolution = await knownFactResolver.resolve({
                    key: proposal?.questionKey,
                    memory: beforeLookup.memory,
                    context: factContext
                });
            } catch {
                factResolution = {
                    key: proposal?.questionKey,
                    status: 'unavailable',
                    fact: null,
                    candidates: [],
                    reason: 'fact_resolver_failed'
                };
            }

            // Re-read after async lookup. If planning moved meanwhile, the
            // deterministic gate sees the new revision/epoch and rejects stale work.
            const current = store.snapshot();
            const questionOpen = hasOpenCustomerQuestion ?? current.openQuestions.length > 0;
            let reviews = [];
            try {
                reviews = await reviewers?.review({
                    proposal, factResolution, state: current,
                    hasOpenCustomerQuestion: questionOpen
                }) ?? [];
                if (!Array.isArray(reviews)) reviews = [{ id: null, status: 'skipped_invalid_output' }];
            } catch {
                reviews = [{ id: null, status: 'skipped_pipeline_error' }];
            }
            // A reviewer may have awaited a model. Gate against the latest
            // reducer state so stale plans never gain authority.
            const latest = store.snapshot();
            const factChanged = JSON.stringify(beforeLookup.memory.discoveredFacts?.[proposal?.questionKey])
                !== JSON.stringify(latest.memory.discoveredFacts?.[proposal?.questionKey]);
            const resolvedFact = factChanged
                ? { key: proposal?.questionKey, status: 'unavailable', fact: null,
                    candidates: [], reason: 'fact_changed_during_review' }
                : factResolution;
            const decision = evaluate({
                proposal,
                policy,
                fieldDefinitions,
                factResolution: resolvedFact,
                memory: latest.memory,
                runtime: {
                    routeRevision: latest.routeRevision,
                    epoch: latest.adaptiveSurvey.epoch,
                    activeSurveyId: latest.adaptiveSurvey.activeSurveyId,
                    shownCount: latest.adaptiveSurvey.shownCount,
                    lastSurveyTurn: latest.adaptiveSurvey.lastOpenedTurn
                },
                hasOpenCustomerQuestion: hasOpenCustomerQuestion
                    ?? latest.openQuestions.length > 0
            });
            store.dispatch({
                type: 'SURVEY_PROPOSAL_REVIEWED',
                proposal: decision.proposal ?? proposal,
                decision
            });
            try {
                onDecision({
                    proposalId: proposal?.proposalId ?? null,
                    questionKey: proposal?.questionKey ?? null,
                    purpose: proposal?.purpose ?? null,
                    status: decision.status,
                    reason: decision.reason,
                    channel: decision.channel ?? null,
                    routeRevision: latest.routeRevision,
                    epoch: latest.adaptiveSurvey.epoch,
                    factStatus: resolvedFact.status,
                    reviewStatuses: reviews.map((review) => `${review.id ?? 'pipeline'}:${review.status}`)
                });
            } catch {
                // Decision telemetry cannot affect the survey authority path.
            }
            return { decision, factResolution: resolvedFact, reviews, state: store.snapshot() };
        }
    };
}
