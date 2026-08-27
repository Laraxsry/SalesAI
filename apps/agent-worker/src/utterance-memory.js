/**
 * Remembers what the agent actually said out loud, so that "do not repeat
 * yourself" can point at something.
 *
 * Every anti-repetition instruction in @repo/agent used to be a blind
 * admonition — the model was told not to say the same thing twice without ever
 * being shown the sentence in question. Quoting the real utterance back into
 * the one-shot instruction is what turns that from a wish into something the
 * model can act on.
 *
 * Pure in-memory, no I/O — same shape as `realtime-gate.js`,
 * `silence-driver.js` and `session-cost-tracker.js`: this only remembers, the
 * caller decides what a memory means.
 *
 * @param {object} [opts]
 * @param {number} [opts.keep=3]       how many recent utterances to retain
 * @param {number} [opts.maxChars=400] length of the excerpt `last()` returns
 */
export function createUtteranceMemory({ keep = 3, maxChars = 400 } = {}) {
    /** @type {Array<{text:string, interrupted:boolean}>} */
    const entries = [];

    /**
     * Keeps the TAIL, not the head. For a narration that was cut off, where it
     * stopped is the informative part — the opening words are what the model
     * would have reproduced anyway.
     */
    function excerpt(text) {
        return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
    }

    return {
        /**
         * @param {string} text
         * @param {{interrupted?: boolean}} [meta]
         */
        record(text, { interrupted = false } = {}) {
            const trimmed = String(text || '').trim();
            // A text-modality-only or empty item would otherwise poison the
            // memory with '' and make `last()` return a useless referent.
            if (!trimmed) return;
            entries.push({ text: trimmed, interrupted });
            if (entries.length > keep) entries.shift();
        },

        /** @returns {{text:string, interrupted:boolean}|null} */
        last() {
            const entry = entries[entries.length - 1];
            return entry ? { text: excerpt(entry.text), interrupted: entry.interrupted } : null;
        },

        /** @returns {Array<{text:string, interrupted:boolean}>} newest last */
        recent(n = keep) {
            return entries.slice(-n).map((e) => ({ text: excerpt(e.text), interrupted: e.interrupted }));
        },

        clear() {
            entries.length = 0;
        }
    };
}
