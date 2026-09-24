/** Pure decoder/reducer for the worker's in-call survey data messages. */
export function decodeSurveyMessage(payload) {
    try {
        const value = typeof payload === 'string'
            ? payload
            : new TextDecoder().decode(payload);
        const message = JSON.parse(value);
        return message?.type === 'salesai:survey' ? message : null;
    } catch {
        return null;
    }
}

export function applySurveyMessage(current, payload) {
    const message = decodeSurveyMessage(payload);
    if (!message) return current;
    if (message.action === 'hide') {
        return !current || current.nodeId === message.nodeId ? null : current;
    }
    if (message.action !== 'show' || !message.nodeId || !message.question) return current;
    const adaptive = message.mode === 'adaptive';
    const answerType = adaptive
        ? ['single_select', 'multi_select', 'short_text', 'number'].includes(message.answerType)
            ? message.answerType : null
        : message.answerType === 'text' ? 'text' : 'single-choice';
    if (!answerType) return current;
    return {
        nodeId: String(message.nodeId),
        mode: adaptive ? 'adaptive' : 'static',
        question: String(message.question),
        answerType,
        options: Array.isArray(message.options)
            ? message.options
                  .filter((option) => option && option.value && option.label)
                  .map((option) => ({ value: String(option.value), label: String(option.label) }))
                  .slice(0, 8)
            : [],
        allowFreeText: Boolean(message.allowFreeText),
        required: message.required !== false,
        expiresAt: adaptive && Number.isFinite(message.expiresAt) ? message.expiresAt : null,
        position: Number.isInteger(message.position) && message.position > 0 ? message.position : null,
        total: Number.isInteger(message.total) && message.total > 0 ? message.total : null
    };
}
