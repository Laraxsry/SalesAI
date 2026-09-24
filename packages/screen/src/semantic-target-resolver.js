import { foldSnapshotText, parseSnapshotElements } from './chrome-snapshot.js';

const ROLE_PREFERENCE = {
    click: new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio']),
    focus: new Set(['button', 'link', 'tab', 'menuitem', 'heading', 'textbox', 'combobox']),
    resolve: new Set(['button', 'link', 'tab', 'menuitem', 'heading', 'textbox', 'combobox'])
};

function tokens(value) {
    return foldSnapshotText(value)
        .split(/[^a-z0-9çğıöşü]+/i)
        .filter((token) => token.length >= 3);
}

function relatedToken(left, right) {
    return left === right
        || (left.length >= 4 && right.length >= 4 && left.slice(0, 4) === right.slice(0, 4));
}

function scoreElement(element, target, intent) {
    const foldedTarget = foldSnapshotText(target).trim();
    const foldedName = foldSnapshotText(element.name).trim();
    if (!foldedTarget || !foldedName) return 0;

    let score = 0;
    if (foldedName === foldedTarget) score += 100;
    else if (foldedName.includes(foldedTarget)) score += 75;
    else if (foldedTarget.includes(foldedName) && foldedName.length >= 3) score += 55;

    const targetTokens = tokens(foldedTarget);
    const nameTokens = tokens(foldedName);
    const matched = targetTokens.filter((targetToken) =>
        nameTokens.some((nameToken) => relatedToken(targetToken, nameToken))).length;
    if (targetTokens.length > 0) score += Math.round((matched / targetTokens.length) * 40);
    if (ROLE_PREFERENCE[intent]?.has(element.role)) score += 10;
    return score;
}

/** Resolve a semantic planner target against only the latest MCP snapshot. */
export function resolveSnapshotTarget(snapshotText, { target, intent = 'focus' }) {
    const ranked = parseSnapshotElements(snapshotText)
        .map((element) => ({ element, score: scoreElement(element, target, intent) }))
        .filter((candidate) => candidate.score >= 35)
        .sort((left, right) => right.score - left.score || left.element.index - right.element.index);

    if (ranked.length === 0) return { ok: false, reason: 'target_not_found' };
    if (ranked[1] && ranked[1].score === ranked[0].score) {
        return {
            ok: false,
            reason: 'ambiguous_target',
            candidateUids: ranked.filter((candidate) => candidate.score === ranked[0].score)
                .map((candidate) => candidate.element.uid)
        };
    }

    return {
        ok: true,
        uid: ranked[0].element.uid,
        role: ranked[0].element.role,
        name: ranked[0].element.name,
        score: ranked[0].score
    };
}
