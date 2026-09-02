/**
 * A tiny FIFO buffer for visitor questions that arrive while the agent is
 * mid-sentence in a group session (Görev #11). The agent-worker fills it from
 * `UserInputTranscribed` and drains it with `flush()` once the current speech
 * finishes, handing everything to one `generateReply`.
 *
 * Pure and dependency-free so it can be unit-tested directly.
 */
export function createQuestionQueue() {
    /** @type {Array<{ speaker: string|null, text: string, at: number }>} */
    let items = [];

    return {
        /** @param {{ speaker?: string|null, text: string }} q */
        enqueue({ speaker = null, text }) {
            const clean = String(text || '').trim();
            if (!clean) return;
            items.push({ speaker: speaker || null, text: clean, at: Date.now() });
        },
        /** Returns everything queued and clears the buffer. */
        flush() {
            const out = items;
            items = [];
            return out;
        },
        size() {
            return items.length;
        },
        isEmpty() {
            return items.length === 0;
        }
    };
}
