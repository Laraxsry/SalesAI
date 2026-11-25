/** How long after a call starts its visitors can still rate it. */
export const FEEDBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound on ratings kept per session (a group call has at most MAX_ROOM_PARTICIPANTS visitors). */
export const MAX_FEEDBACK_ENTRIES = 50;

/**
 * Whether a session can still take a rating at `now`.
 * @param {{ startedAt?: Date|string, createdAt?: Date|string }} session
 */
export function isFeedbackOpen(session, now = Date.now()) {
    const startedAt = new Date(session.startedAt || session.createdAt || 0).getTime();
    return now - startedAt <= FEEDBACK_WINDOW_MS;
}

/**
 * The session's rating list after one visitor submits `entry`: a visitor who
 * already rated (same visitorKey) has their rating replaced, anyone else is
 * appended, and the list never grows past MAX_FEEDBACK_ENTRIES.
 * @param {Array<object>} entries
 * @param {{ rating:number, comment?:string, visitorKey?:string, visitorName?:string, createdAt?:Date }} entry
 * @returns {Array<object>|null} the new list, or null when the list is full
 */
export function applyFeedback(entries = [], entry) {
    const next = { ...entry, createdAt: entry.createdAt || new Date() };
    const index = entry.visitorKey ? entries.findIndex((e) => e.visitorKey === entry.visitorKey) : -1;
    if (index >= 0) return entries.map((e, i) => (i === index ? next : e));
    if (entries.length >= MAX_FEEDBACK_ENTRIES) return null;
    return [...entries, next];
}
