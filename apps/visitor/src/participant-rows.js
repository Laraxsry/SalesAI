/**
 * Turns raw LiveKit room state into the rows the participants panel renders
 * (Görev #11 UI). Pure — no React, no browser APIs — so it can be unit-tested
 * directly and the panel component stays a thin render.
 *
 * @param {object} input
 * @param {Array<{identity?:string,name?:string,isLocal?:boolean}>} input.participants
 * @param {Set<string>|Iterable<string>} [input.speakingIdentities]
 * @param {Map<string,boolean>|Record<string,boolean>} [input.micByIdentity]
 * @param {string} [input.agentState]  useVoiceAssistant().state
 * @returns {{ agent: object, humans: object[], humanCount: number }}
 */
export function buildParticipantRows({
    participants = [],
    speakingIdentities,
    micByIdentity,
    agentState
} = {}) {
    const speaking =
        speakingIdentities instanceof Set ? speakingIdentities : new Set(speakingIdentities || []);
    const micOf = (id) =>
        micByIdentity instanceof Map ? micByIdentity.get(id) : micByIdentity && micByIdentity[id];

    const humans = participants
        .filter((p) => p && (p.isLocal || String(p.identity || '').startsWith('visitor_')))
        .map((p) => {
            const micOn = micOf(p.identity) === true;
            return {
                identity: p.identity,
                name: p.isLocal ? 'Siz' : (typeof p.name === 'string' && p.name.trim()) || 'Ziyaretçi',
                isLocal: Boolean(p.isLocal),
                micOn,
                // A ring only when they can actually be heard — a muted mic
                // that briefly registered as "speaking" must not light up.
                speaking: micOn && speaking.has(p.identity)
            };
        })
        // Speakers float to the top (stable sort keeps arrival order otherwise).
        .sort((a, b) => (b.speaking ? 1 : 0) - (a.speaking ? 1 : 0));

    return {
        agent: { identity: '__agent__', name: 'AI Temsilci', isAgent: true, speaking: agentState === 'speaking' },
        humans,
        humanCount: humans.length
    };
}

/**
 * Whether to surface the participants panel at all. Shown when the session is
 * group-CAPABLE (`maxParticipants > 1`, so a solo tester still finds it) or
 * when 2+ humans are actually in the room (covers a missing prop). A plain
 * 1-on-1 call stays exactly as it was.
 *
 * @param {{ humanCount?: number, maxParticipants?: number }} input
 * @returns {boolean}
 */
export function shouldShowPanel({ humanCount = 0, maxParticipants } = {}) {
    return Number(maxParticipants) > 1 || humanCount >= 2;
}
