/**
 * Group-meeting helpers (Görev #11): who is in the room, and how the agent is
 * told to address them / answer a batch of questions that piled up while it was
 * talking. Pure — the agent-worker passes in the current participant list.
 *
 * A "participant" here is `{ identity, name }`. `identity` is the LiveKit
 * `visitor_*` id; `name` is what the visitor typed on the join screen.
 *
 * Both builders below take an optional `languageDisplay` (spelled-out name,
 * e.g. "Turkish" — see `proactive.js`'s doc comment for why) and append a
 * reminder: these are one-shot `generateReply({instructions})` payloads,
 * entirely in English, injected mid-conversation right when a group turn is
 * being batched/attributed — exactly the pattern observed drifting a live
 * multi-participant session into English.
 */

function displayName(p) {
    return (p && typeof p.name === 'string' && p.name.trim()) || null;
}

/**
 * @param {string} [languageDisplay]
 * @returns {string}
 */
function languageLine(languageDisplay) {
    return languageDisplay
        ? ` Reply in ${languageDisplay}, regardless of what language this instruction itself is written in.`
        : '';
}

/**
 * A one-line roster note for the model, or null when it's not a group (0 or 1
 * named participant — nothing to disambiguate).
 *
 * @param {Array<{identity?:string,name?:string}>} participants
 * @param {string} [languageDisplay]
 * @returns {string|null}
 */
export function buildRosterNote(participants, languageDisplay) {
    const names = (participants || []).map(displayName).filter(Boolean);
    if (names.length < 2) return null;
    return `This is a group session. The people in the room are: ${names.join(', ')}. When you answer a question, address whoever asked it by name; if you don't know who asked, speak to the room.${languageLine(languageDisplay)}`;
}

/**
 * Turns what the room said while the agent was talking into one instruction to
 * answer after it finishes. When someone has the `floor`, chime-ins are folded
 * into that person's answer and new topics are deferred to a raised hand; with
 * an open floor everyone is answered directly. Null when nothing meaningful is
 * buffered.
 *
 * @param {{ floor?: {identity?:string,name?:string}|null, items?: Array<{speaker?:string|null,text:string}>, hands?: Array<{identity?:string,name?:string}>, languageDisplay?: string }} input
 * @returns {string|null}
 */
export function buildTurnResponseInstruction({ floor, items, hands, languageDisplay } = {}) {
    const qs = (items || []).filter((q) => q && String(q.text || '').trim());
    if (!qs.length) return null;
    const lines = qs
        .map((q) => `- ${q.speaker ? `${q.speaker}: ` : ''}${String(q.text).trim()}`)
        .join('\n');

    const floorName = floor && floor.name;
    const parts = [];
    if (floorName) parts.push(`${floorName} currently has the floor.`);
    parts.push('While you were talking, the following came in from the room:');
    parts.push(lines);
    if (floorName) {
        parts.push(
            `Answer ${floorName} fully. Fold in brief on-topic chime-ins by name, but if someone raised a genuinely NEW topic, tell that person by name that you'll get to them and ask them to raise their hand — then stay with ${floorName}.`
        );
    } else {
        parts.push(
            'Answer them now — briefly, addressing each asker by name where you know it, grouping related ones.'
        );
    }
    const waiting = (hands || []).map((h) => h && h.name).filter(Boolean);
    if (waiting.length) {
        parts.push(`Waiting with a raised hand (do NOT switch to them yet): ${waiting.join(', ')}.`);
    }
    parts.push('Do not read this list back or mention that questions were queued.');
    if (languageDisplay) parts.push(`Reply in ${languageDisplay}, regardless of what language this instruction itself is written in.`);
    return parts.join('\n');
}

/**
 * Resolve a LiveKit speaker identity to a display name.
 *
 * @param {Array<{identity?:string,name?:string}>} participants
 * @param {string|null|undefined} speakerId
 * @returns {string|null}
 */
export function resolveSpeaker(participants, speakerId) {
    if (!speakerId) return null;
    const hit = (participants || []).find((p) => p && p.identity === speakerId);
    return hit ? displayName(hit) : null;
}
