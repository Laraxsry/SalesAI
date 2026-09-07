/**
 * Validates an untrusted LiveKit survey answer against the active node.
 * Returns the canonical value/label pair the runtime and analytics consume.
 */
export function normalizeSurveyAnswer(node, message) {
    if (!node || node.type !== 'survey' || !node.survey || message?.nodeId !== node.id) return null;

    const skipped = message?.skipped === true;
    if (skipped) {
        return node.survey.required === false
            ? { answer: null, answerValue: null, skipped: true }
            : null;
    }

    const answerValue = String(message?.answer || '').trim().slice(0, 1000);
    if (!answerValue) return null;

    if (node.survey.answerType === 'single-choice') {
        const option = (node.survey.options || []).find((candidate) => candidate.value === answerValue);
        if (option) return { answer: option.label, answerValue, skipped: false };
        if (!node.survey.allowFreeText) return null;
    }

    return { answer: answerValue, answerValue, skipped: false };
}

/** Builds the canonical persistence/audit record after validation. Keeping
 * this mapping beside answer normalization prevents database, timeline and
 * lead projections from silently drifting to different field sets. */
export function buildSurveyAnswerRecord(
    node,
    normalized,
    { answerId = null, participant = null, answeredAt = new Date() } = {}
) {
    return {
        answerId,
        nodeId: node.id,
        fieldKey: node.survey?.fieldKey || null,
        question: node.survey?.question || null,
        answer: normalized.answer,
        answerValue: normalized.answerValue,
        skipped: normalized.skipped,
        participant,
        answeredAt
    };
}
