import { diffArrays } from 'diff';

/**
 * Diffs two chunk-text arrays (the output of `chunkText()` run on the old
 * vs. new full source text) so an edit only touches the chunks that
 * actually changed. `chunkText()` is a deterministic pure function of the
 * whole text — it doesn't address chunks by position — so there's no
 * offset/id to diff directly; comparing the two resulting chunk arrays
 * (LCS-based, via `diffArrays`) is what stands in for that. A chunk
 * untouched by the edit lands in neither `added` nor `removed`: it's
 * skipped entirely (no re-embed, no re-classify, no delete/insert) — that
 * skip is the whole point of this module.
 *
 * @param {string[]} oldChunks
 * @param {string[]} newChunks
 * @returns {{ added: string[], removed: string[], unchangedCount: number }}
 */
export function diffChunks(oldChunks, newChunks) {
    const parts = diffArrays(oldChunks, newChunks);
    const added = [];
    const removed = [];
    let unchangedCount = 0;

    for (const part of parts) {
        if (part.added) added.push(...part.value);
        else if (part.removed) removed.push(...part.value);
        else unchangedCount += part.value.length;
    }

    return { added, removed, unchangedCount };
}

/**
 * True if two chunk-text arrays contain exactly the same texts the same
 * number of times each (order-independent). Used as the safety net before
 * trusting a partial re-chunk: if what's actually stored for a source
 * doesn't match what `chunkText()` deterministically produces from the
 * "old" text we're diffing against, a partial update can't be trusted to
 * correctly identify which stored chunks correspond to the edit — falls
 * back to a full re-ingest instead (see `reingestSourceIncremental()` in
 * `ingest.js`).
 *
 * @param {string[]} a
 * @param {string[]} b
 */
export function multisetEqual(a, b) {
    if (a.length !== b.length) return false;
    const counts = new Map();
    for (const item of a) counts.set(item, (counts.get(item) || 0) + 1);
    for (const item of b) {
        const n = counts.get(item) || 0;
        if (n === 0) return false;
        counts.set(item, n - 1);
    }
    return true;
}

/**
 * Matches each text in `removedTexts` to one stored chunk id from
 * `existing` (`{id, text}[]`) — consumes one candidate per match so
 * duplicate chunk texts (rare, but `chunkText()` doesn't guarantee
 * uniqueness) each get a distinct id rather than all resolving to the same
 * one. Throws if a removed text has no remaining stored match — that would
 * mean `multisetEqual()` was wrongly satisfied, a bug, not a normal case to
 * silently ignore.
 *
 * @param {string[]} removedTexts
 * @param {{id:string, text:string}[]} existing
 * @returns {string[]} ids to delete
 */
export function matchTextsToIds(removedTexts, existing) {
    const byText = new Map();
    for (const { id, text } of existing) {
        if (!byText.has(text)) byText.set(text, []);
        byText.get(text).push(id);
    }

    const ids = [];
    for (const text of removedTexts) {
        const candidates = byText.get(text);
        if (!candidates || candidates.length === 0) {
            throw new Error(`No stored chunk id left to match removed text (length ${text.length})`);
        }
        ids.push(candidates.shift());
    }
    return ids;
}
