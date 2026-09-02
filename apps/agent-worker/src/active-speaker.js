/**
 * Mic-aware active-speaker helpers for group sessions (Görev #11 follow-up).
 *
 * The agent follows whoever is speaking, but must only ever consider a visitor
 * whose microphone is actually ON — someone who unmutes, says something, then
 * mutes again must not still be treated as "the speaker" a beat later, or the
 * agent attributes the next thing it hears to the wrong person (or to a person
 * who can no longer be heard at all).
 *
 * Pure — the agent-worker maps LiveKit participants/publications to the plain
 * shapes these take.
 */

/**
 * The visitor the realtime model should be listening to right now.
 *
 * @param {Array<{ identity?: string, micOn?: boolean }>} candidates
 *   the room's currently-active speakers, mapped to {identity, micOn}
 * @returns {string|null} identity, or null when nobody eligible is speaking
 */
export function pickActiveSpeaker(candidates) {
    for (const c of candidates || []) {
        if (c && typeof c.identity === 'string' && c.identity.startsWith('visitor_') && c.micOn === true) {
            return c.identity;
        }
    }
    return null;
}

/**
 * Who a just-transcribed utterance should be attributed to.
 *
 * `eventSpeakerId` (from the SDK's `UserInputTranscribed`) is authoritative
 * when present — those words genuinely came from that participant, even if
 * they have since muted. Only when it's missing do we fall back to the last
 * known active speaker, and only if their mic is STILL on — otherwise we
 * don't guess, and the agent addresses the room instead.
 *
 * @param {object} input
 * @param {string|null|undefined} input.eventSpeakerId
 * @param {string|null|undefined} input.fallbackIdentity  last active speaker
 * @param {(identity: string) => boolean} input.micOnFor  live mic-state lookup
 * @returns {string|null}
 */
export function chooseAttribution({ eventSpeakerId, fallbackIdentity, micOnFor }) {
    if (eventSpeakerId && typeof eventSpeakerId === 'string') return eventSpeakerId;
    if (fallbackIdentity && typeof micOnFor === 'function' && micOnFor(fallbackIdentity) === true) {
        return fallbackIdentity;
    }
    return null;
}
