/**
 * Görev #11 group-meeting status line — shown under the AI orb (or as a small
 * chip when the tour video is up), NOT a separate panel. Pure so it can be
 * unit-tested and the component stays a thin render.
 */

/**
 * The reducer behind the `useMeetingState` hook: fold one incoming data-channel
 * message into the last known meeting state. The agent-worker always sends the
 * FULL state (never a delta), so this is a validate-and-replace.
 *
 * @param {object|null} prev
 * @param {string|Uint8Array} raw  the raw data-channel payload
 * @returns {object|null} new state, or `prev` when the message isn't ours
 */
export function applyMeetingMessage(prev, raw) {
    let msg;
    try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
        return prev;
    }
    if (!msg || msg.type !== 'salesai:meeting') return prev;
    return {
        phase: msg.phase === 'live' ? 'live' : 'waiting',
        visitorCount: Number(msg.visitorCount) || 0,
        maxParticipants: Number(msg.maxParticipants) || 0,
        floor: msg.floor && msg.floor.identity ? { identity: msg.floor.identity, name: msg.floor.name || null } : null,
        hands: Array.isArray(msg.hands)
            ? msg.hands.filter((h) => h && h.identity).map((h) => ({ identity: h.identity, name: h.name || null }))
            : []
    };
}

/**
 * The one-line status string, or '' when the normal state label should show
 * instead (a plain 1-on-1 call, or a live meeting with an open floor).
 *
 * @param {object|null} state  from applyMeetingMessage
 * @param {string} [selfIdentity]  this viewer's LiveKit identity — rendered "siz"
 * @returns {string}
 */
export function buildMeetingStatusText(state, selfIdentity) {
    if (!state) return '';
    const label = (p) => (p && p.identity === selfIdentity ? 'siz' : (p && p.name) || 'bir katılımcı');

    if (state.phase === 'waiting') {
        const n = state.visitorCount;
        return `${n} kişi katıldı — sunum başlamak için bekleniyor`;
    }

    if (!state.floor) return '';

    let text = `${label(state.floor)} ile konuşuluyor`;
    if (state.hands.length) {
        text += ` · Sırada: ${state.hands.map(label).join(', ')}`;
    }
    return text;
}
