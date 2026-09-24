/**
 * Decides whether silence advances a presentation or merely leaves room for
 * the visitor. A question never becomes answered just because time passed.
 */
export function createConversationIdlePolicy() {
    let awaitingAnswer = false;
    let checkInSent = false;

    return {
        onQuestionAsked() {
            awaitingAnswer = true;
            checkInSent = false;
        },
        onVisitorTurn() {
            awaitingAnswer = false;
            checkInSent = false;
        },
        onAssistantUtterance(text, { presentationActive = false } = {}) {
            if (!presentationActive && !checkInSent
                && /\?\s*$/.test(String(text ?? '').trim())) {
                awaitingAnswer = true;
                checkInSent = false;
                return true;
            }
            return false;
        },
        decide({ presentationActive = false } = {}) {
            if (!awaitingAnswer && presentationActive) return 'advance_presentation';
            if (checkInSent) return 'wait';
            checkInSent = true;
            return 'check_in';
        },
        get awaitingAnswer() { return awaitingAnswer; }
    };
}

/** Spoken check-in is intentionally short and contains no sales follow-up. */
export function buildPresenceCheckInstructions(languageDisplay = 'the conversation language') {
    const example = /turkish|türkçe/iu.test(languageDisplay)
        ? '"Hâlâ benimle misiniz? Hazır olduğunuzda devam edebiliriz."'
        : 'a brief equivalent of "Are you still with me? We can continue whenever you are ready."';
    return `In ${languageDisplay}, say only ${example} Do not discuss the product, ask a discovery question, call tools, or treat silence as an answer. After this, wait for the visitor.`;
}
