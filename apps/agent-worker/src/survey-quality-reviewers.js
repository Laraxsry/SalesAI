/** Quality signals only: the survey gate owns all approve/reject decisions. */
export function createKnownFactSurveyReviewer() {
    return {
        id: 'known_fact',
        review({ factResolution }) {
            return ['known', 'verify', 'conflict', 'declined', 'unavailable']
                .includes(factResolution?.status)
                ? { status: 'flagged', reason: `fact_${factResolution.status}` }
                : { status: 'passed' };
        }
    };
}

export function createConversationTimingSurveyReviewer() {
    return {
        id: 'conversation_timing',
        review({ hasOpenCustomerQuestion, state }) {
            if (hasOpenCustomerQuestion) {
                return { status: 'flagged', reason: 'answer_first' };
            }
            if (state?.adaptiveSurvey?.activeSurveyId) {
                return { status: 'flagged', reason: 'survey_active' };
            }
            return { status: 'passed' };
        }
    };
}
