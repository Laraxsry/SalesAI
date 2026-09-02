/**
 * Pure decision helpers for the multi-participant "meeting" flow (Görev #1).
 *
 * When an agent's `maxParticipants > 1`, the agent joins the room and WAITS
 * before starting the presentation: it begins once the room is full, or once
 * a visitor answers "yes, start" to the check it asks every minute, or once a
 * safety timeout elapses. These functions hold that logic with no I/O so the
 * agent-worker just wires events to them and they can be unit-tested.
 */

/** Turkish-first, English-fallback. Locale-aware lowercase like tools.js. */
function normalize(text) {
    return String(text || '').toLocaleLowerCase('tr');
}

const START_WORDS = [
    'başla',
    'başlayal',
    'başlayab',
    'başlasın',
    'hazır',
    'evet',
    'tamam',
    'olur',
    'devam',
    'geçel',
    'hadi',
    'start',
    'begin',
    'ready',
    'yes',
    'go ahead',
    "let's go",
    'lets go',
    'proceed',
    'sure'
];

const WAIT_WORDS = [
    'bekle',
    'bekliy',
    'dur ',
    'hayır',
    'henüz',
    'gelecek',
    'geliyor',
    'birkaç',
    'biraz daha',
    'katılac',
    'kişi daha',
    'wait',
    'hold on',
    'not yet',
    ' no',
    'no,',
    'more people',
    'someone else',
    'others are coming',
    'a few more'
];

/**
 * Reads a visitor's answer to "shall we start, or wait for more people?".
 *
 * @param {string} text
 * @returns {'start' | 'wait' | 'unclear'}
 */
export function classifyStartIntent(text) {
    const t = ` ${normalize(text)} `;
    if (!t.trim()) return 'unclear';
    const startHits = START_WORDS.filter((w) => t.includes(w)).length;
    const waitHits = WAIT_WORDS.filter((w) => t.includes(w)).length;
    if (startHits > waitHits) return 'start';
    if (waitHits > startHits) return 'wait';
    return 'unclear';
}

/**
 * Whether the presentation should begin now.
 *
 * @param {object} ctx
 * @param {number} ctx.visitorCount   how many visitors are currently in the room
 * @param {number} ctx.maxParticipants pinned Agent.maxParticipants (agent not counted)
 * @param {number} ctx.waitedMs       ms elapsed since the agent joined
 * @param {number} ctx.maxWaitMs      safety ceiling — start regardless past this
 * @param {'start'|'wait'|'unclear'|null} [ctx.lastIntent] last visitor answer to the check
 * @returns {boolean}
 */
export function shouldStartMeeting({ visitorCount, maxParticipants, waitedMs, maxWaitMs, lastIntent = null }) {
    if (!visitorCount || visitorCount < 1) return false; // nobody to present to
    if (visitorCount >= maxParticipants) return true; // room full
    if (lastIntent === 'start') return true; // a visitor said go
    if (typeof maxWaitMs === 'number' && waitedMs >= maxWaitMs) return true; // waited long enough
    return false;
}

/**
 * One-shot instruction for the "shall we start?" check the agent voices every
 * minute while waiting. Content-instruction, not a literal line (same shape as
 * `buildIdleNudgeInstructions`).
 *
 * @param {{ visitorCount:number, maxParticipants:number }} ctx
 * @returns {string}
 */
export function buildWaitingRoomPrompt({ visitorCount, maxParticipants }) {
    return [
        `There are currently ${visitorCount} visitor(s) in the room and this session is for up to ${maxParticipants}.`,
        'In one short, warm line in the conversation\'s language, ask whether they would like to begin now or wait a little longer for others to join.',
        'Ask once, then stop — do not repeat it, do not add anything else, and do not call any tools.'
    ].join(' ');
}
