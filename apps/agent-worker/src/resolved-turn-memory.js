function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isQuestion(value) {
    return /\?\s*$/.test(clean(value));
}

/**
 * Synchronous bridge between the question the speaking agent just asked and
 * the visitor's next final transcript. Background analysts may enrich this
 * later; continuity for the next turn must not wait for them.
 */
export function createResolvedTurnMemory({ keep = 8, maxChars = 1800 } = {}) {
    const exchanges = [];

    return {
        record({ question, answer, interrupted = false }) {
            const normalizedQuestion = clean(question);
            const normalizedAnswer = clean(answer);
            if (interrupted || !isQuestion(normalizedQuestion) || !normalizedAnswer
                || isQuestion(normalizedAnswer)) return false;

            const duplicate = exchanges.some((exchange) =>
                exchange.question === normalizedQuestion
                && exchange.answer === normalizedAnswer);
            if (duplicate) return false;

            exchanges.push({ question: normalizedQuestion, answer: normalizedAnswer });
            if (exchanges.length > keep) exchanges.shift();
            return true;
        },

        instruction() {
            if (exchanges.length === 0) return '';
            const lines = exchanges.map((exchange) =>
                `- Asked: ${exchange.question}\n  Visitor replied: ${exchange.answer}`);
            const bounded = lines.join('\n').slice(-maxChars);
            return [
                'RESOLVED CONVERSATION TURNS (private; never quote this heading):',
                bounded,
                'Treat the information in these replies as already collected. Do not ask for the same information again in different words. A later explicit correction overrides an earlier reply. Ask a follow-up only for a genuinely missing fact required by the current customer request; otherwise answer, demonstrate, or conclude.'
            ].join('\n');
        },

        snapshot() {
            return exchanges.map((exchange) => ({ ...exchange }));
        }
    };
}
