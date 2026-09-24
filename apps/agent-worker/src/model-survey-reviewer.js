/**
 * Vendor-neutral, opt-in survey critic. The default projection contains only
 * structured control signals, never transcript, question text or fact value.
 */
export function createModelSurveyReviewer({
    model,
    invoke,
    enabled = () => false,
    timeoutMs = 800
}) {
    if (typeof model !== 'string' || !model.trim() || typeof invoke !== 'function') {
        throw new TypeError('model and invoke are required');
    }
    return {
        id: 'model_critic', enabled, timeoutMs,
        review({ proposal, factResolution, state, hasOpenCustomerQuestion }, { signal } = {}) {
            return invoke({
                model,
                input: {
                    purpose: proposal?.purpose ?? null,
                    questionKey: proposal?.questionKey ?? null,
                    answerType: proposal?.answerType ?? null,
                    requiredFor: proposal?.requiredFor ?? [],
                    factStatus: factResolution?.status ?? 'unavailable',
                    hasOpenCustomerQuestion: hasOpenCustomerQuestion === true,
                    anotherSurveyActive: Boolean(state?.adaptiveSurvey?.activeSurveyId),
                    shownCount: state?.adaptiveSurvey?.shownCount ?? 0
                },
                signal
            });
        }
    };
}
