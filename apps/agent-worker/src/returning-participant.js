/**
 * Recognises a visitor who dropped and rejoined the same meeting (Görev #11).
 * Their LiveKit `identity` changes on every (re)connect, so we match on the
 * stable `visitorKey` the visitor keeps in localStorage — falling back to an
 * exact name match only when neither side has a key.
 *
 * Pure — the agent-worker passes in its in-memory roster history.
 *
 * @param {Array<{identity?:string,name?:string,visitorKey?:string,leftAt?:*}>} priorParticipants
 * @param {{ visitorKey?: string, name?: string }} [incoming]
 * @returns {{identity?:string,name?:string,visitorKey?:string,leftAt?:*}|null}
 *   the prior roster entry this is a return of, or null
 */
export function matchReturningParticipant(priorParticipants, { visitorKey, name } = {}) {
    const left = (priorParticipants || []).filter((p) => p && p.leftAt);
    if (!left.length) return null;

    if (visitorKey) {
        const byKey = left.find((p) => p.visitorKey && p.visitorKey === visitorKey);
        if (byKey) return byKey;
    }

    if (name && String(name).trim()) {
        const norm = String(name).trim().toLocaleLowerCase('tr');
        // Only when neither side carries a key — two different people can share
        // a first name, so a key mismatch must never fall through to this.
        const byName = left.find(
            (p) => !p.visitorKey && String(p.name || '').trim().toLocaleLowerCase('tr') === norm
        );
        if (byName) return byName;
    }

    return null;
}
