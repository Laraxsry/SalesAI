/** Shadow observations follow the active shadow session and remain visitor-invisible. */
export function decideAdaptiveSurveyShadowActivation({
    featureEnabled = false, productConfigValid = false, rolloutDecision,
    maxParticipants = 1
}) {
    return featureEnabled === true && productConfigValid === true
        && rolloutDecision?.cohort === 'shadow'
        && rolloutDecision.dynamicStateEnabled === true && maxParticipants === 1;
}

/**
 * Measures configured-field knowledge after a spoken answer. It never creates
 * a SurveyProposal, calls a model/tool, or writes to the conversation reducer.
 */
export function createAdaptiveSurveyShadowObserver({
    store, fields, knownFactResolver, onObservation = () => {}
}) {
    if (!store?.snapshot || !knownFactResolver?.resolve || !Array.isArray(fields)) {
        throw new TypeError('shadow observer requires state, fields and fact resolver');
    }
    const eligibleFields = fields.filter((field) => field.importance !== 'do_not_ask'
        && field.preferredInput !== 'voice' && field.affects?.length > 0);
    const lastStatus = new Map();
    let lastTurn = -1;
    let observing = false;
    return {
        async observe({ canObserve = true } = {}) {
            const allowed = () => typeof canObserve === 'function'
                ? canObserve() === true : canObserve === true;
            const initial = store.snapshot();
            if (!allowed() || observing || initial.memory.turnIndex < 1
                || initial.memory.turnIndex === lastTurn
                || initial.openQuestions.length > 0
                || initial.adaptiveSurvey.activeSurveyId) return [];
            observing = true;
            lastTurn = initial.memory.turnIndex;
            const observations = [];
            try {
                for (const field of eligibleFields) {
                    const initialFact = JSON.stringify(
                        initial.memory.discoveredFacts?.[field.key]
                    );
                    const initialQuestion = JSON.stringify(
                        initial.memory.askedQuestions?.[field.key]
                    );
                    let resolution;
                    try {
                        resolution = await knownFactResolver.resolve({
                            key: field.key, memory: initial.memory
                        });
                    } catch {
                        resolution = { status: 'unavailable' };
                    }
                    const latest = store.snapshot();
                    if (!allowed() || latest.memory.turnIndex !== initial.memory.turnIndex
                        || latest.routeRevision !== initial.routeRevision
                        || latest.adaptiveSurvey.epoch !== initial.adaptiveSurvey.epoch
                        || JSON.stringify(latest.memory.discoveredFacts?.[field.key]) !== initialFact
                        || JSON.stringify(latest.memory.askedQuestions?.[field.key])
                            !== initialQuestion) break;
                    const status = {
                        unknown: 'unknown_field_candidate', known: 'already_known',
                        declined: 'previously_declined', verify: 'verify_voice',
                        conflict: 'verify_voice', unavailable: 'unavailable'
                    }[resolution?.status] ?? 'unavailable';
                    if (lastStatus.get(field.key) === status) continue;
                    lastStatus.set(field.key, status);
                    const observation = { questionKey: field.key, status,
                        factStatus: resolution?.status ?? 'unavailable',
                        turnIndex: initial.memory.turnIndex };
                    observations.push(observation);
                    try { onObservation(observation); } catch { /* telemetry only */ }
                }
                return observations;
            } finally {
                observing = false;
            }
        }
    };
}
