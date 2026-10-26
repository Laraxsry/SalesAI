import { foldSnapshotText, parseSnapshotElements } from './chrome-snapshot.js';
import { resolveSnapshotTarget } from './semantic-target-resolver.js';

const PRESSABLE = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio']);
// resolveSnapshotTarget scores: 75 = one label contains the other, 55 = partly shared words. Below that is a guess.
const MIN_SIMILAR_SCORE = 75;

/**
 * Find the element a learned procedure step means, in the latest snapshot. Tries in order:
 *   1. exact: a pressable element whose name is exactly the recipe's label;
 *   2. similar: a pressable element whose name contains (or is contained in) the label, e.g. "Create" for "Create variable".
 * Anything weaker is reported as not found rather than guessed, because the caller is about to press it.
 * Returns { ok, uid, name, tier } or { ok:false, reason, candidateUids? }.
 */
export function findProcedureTarget(snapshotText, { label }) {
    const wanted = foldSnapshotText(label || '').trim();
    if (!wanted) return { ok: false, reason: 'no_label' };

    const pressable = parseSnapshotElements(snapshotText).filter((element) => PRESSABLE.has(element.role));
    const exact = pressable.filter((element) => foldSnapshotText(element.name).trim() === wanted);
    if (exact.length === 1) return { ok: true, uid: exact[0].uid, name: exact[0].name, tier: 'exact' };
    if (exact.length > 1) return { ok: false, reason: 'ambiguous_target', candidateUids: exact.map((element) => element.uid) };

    const similar = resolveSnapshotTarget(snapshotText, { target: label, intent: 'click' });
    if (similar.ok && PRESSABLE.has(similar.role) && similar.score >= MIN_SIMILAR_SCORE) {
        return { ok: true, uid: similar.uid, name: similar.name, tier: 'similar' };
    }
    if (!similar.ok && similar.reason === 'ambiguous_target') return similar;
    return { ok: false, reason: 'target_not_found' };
}
