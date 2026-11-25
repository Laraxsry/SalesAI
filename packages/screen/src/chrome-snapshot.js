function fold(value = '') {
    return value
        .toLocaleLowerCase('tr')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i');
}

const ROW_ROLES = new Set(['row', 'listitem', 'treeitem', 'article']);
// A container with no row role still counts as "the row" if it is small: a few elements, not a whole page.
const MAX_ROW_LINES = 30;

/**
 * Parse the stable subset of Chrome DevTools MCP's accessibility snapshot.
 *
 * Each element also carries `rowText`: the folded text of the row it sits in (the nearest ancestor with a row
 * role, or failing that the nearest small container that holds more than the element itself). It lets a caller
 * ask "is this button on a row that mentions X?" — for instance, that it belongs to a record a demo created.
 */
export function parseSnapshotElements(snapshotText = '') {
    const lines = snapshotText.split('\n');
    const count = lines.length;
    const indentOf = (line) => line.match(/^\s*/)?.[0].length ?? 0;

    // This runs synchronously inside the LiveKit job process, several times per navigation, on snapshots of
    // thousands of lines. Rescanning subtrees per element made it cubic and blocked the event loop long enough
    // for LiveKit to declare the job orphaned. Everything below is precomputed in linear passes instead.
    const indents = new Array(count);
    const subtreeEnd = new Array(count).fill(count); // exclusive: first non-empty line back at or above this indent
    const nonEmptyBefore = new Array(count + 1); // prefix counts over lines[0..i)
    const uidBefore = new Array(count + 1);
    nonEmptyBefore[0] = 0;
    uidBefore[0] = 0;
    const open = [];
    for (let i = 0; i < count; i++) {
        const line = lines[i];
        const nonEmpty = line.trim() !== '';
        indents[i] = indentOf(line);
        nonEmptyBefore[i + 1] = nonEmptyBefore[i] + (nonEmpty ? 1 : 0);
        uidBefore[i + 1] = uidBefore[i] + (/\buid=/.test(line) ? 1 : 0);
        if (!nonEmpty) continue;
        while (open.length && indents[open.at(-1)] >= indents[i]) subtreeEnd[open.pop()] = i;
        open.push(i);
    }
    // A subtree is the line itself plus the non-empty lines nested under it.
    const subtreeSize = (start) => 1 + nonEmptyBefore[subtreeEnd[start]] - nonEmptyBefore[start + 1];
    const subtreeUids = (start) => uidBefore[subtreeEnd[start]] - uidBefore[start];
    const rowTextCache = new Map();
    const rowTextOf = (start) => {
        if (!rowTextCache.has(start)) {
            const found = [lines[start]];
            for (let next = start + 1; next < subtreeEnd[start]; next++) {
                if (lines[next].trim()) found.push(lines[next]);
            }
            rowTextCache.set(start, fold(found.join(' ')));
        }
        return rowTextCache.get(start);
    };

    const ancestors = [];
    let formDepth = 0;
    const elements = [];
    for (let index = 0; index < count; index++) {
        const line = lines[index];
        const uid = line.match(/\buid=([^\s]+)/)?.[1];
        if (!uid) continue;
        const indent = indents[index];
        while (ancestors.length && ancestors.at(-1).indent >= indent) {
            if (ancestors.pop().role === 'form') formDepth--;
        }
        const afterUid = line.slice(line.indexOf(`uid=${uid}`) + uid.length + 4).trim();
        const role = afterUid.match(/^([\w-]+)/)?.[1]?.toLowerCase() ?? '';
        const name = afterUid.match(/^[\w-]+\s+"([^"]*)"/)?.[1] ?? '';
        const insideForm = formDepth > 0;

        let row = null;
        for (let a = ancestors.length - 1; a >= 0 && !row; a--) {
            if (ROW_ROLES.has(ancestors[a].role)) row = ancestors[a];
        }
        for (let a = ancestors.length - 1; a >= 0 && !row; a--) {
            const size = subtreeSize(ancestors[a].index);
            if (size > 1 && size <= MAX_ROW_LINES && subtreeUids(ancestors[a].index) > 1) row = ancestors[a];
        }
        const rowText = row ? rowTextOf(row.index) : '';

        ancestors.push({ indent, role, index });
        if (role === 'form') formDepth++;
        elements.push({ uid, role, name, line, index, insideForm, rowText,
            folded: fold(`${role} ${name} ${line}`) });
    }
    return elements;
}

export function snapshotElementByUid(snapshotText, uid) {
    return parseSnapshotElements(snapshotText).find((element) => element.uid === uid) ?? null;
}

function score(element, terms) {
    return terms.reduce((total, term) => total + (element.folded.includes(term) ? 1 : 0), 0);
}

function loginSubmitScore(element) {
    const name = fold(element.name).trim();
    const loginActions = ['log in', 'login', 'sign in', 'giris', 'giris yap', 'oturum ac'];
    const roleScore = element.role === 'button' ? 10 : 0;
    const formScore = element.insideForm ? 20 : 0;
    if (loginActions.includes(name)) return 100 + roleScore + formScore;
    if (loginActions.some((term) => name.includes(term))) return 80 + roleScore + formScore;
    if (['continue', 'devam et', 'next', 'ileri'].some((term) => name.includes(term))) {
        return 20 + roleScore + formScore;
    }
    return 0;
}

function compileOverride(override, label) {
    if (!override) return null;
    try {
        return new RegExp(override, 'i');
    } catch (error) {
        throw new Error(`[ChromeMcpTour] Configured mcpSelectors.${label} is not a valid regex: ${error.message}`);
    }
}

function overridden(elements, override, label) {
    const pattern = compileOverride(override, label);
    if (!pattern) return null;
    const match = elements.find((element) => pattern.test(element.line));
    if (!match) {
        throw new Error(`[ChromeMcpTour] Configured mcpSelectors.${label} matched nothing in the live snapshot: ${override}`);
    }
    return match;
}

/**
 * Resolve a login form as one semantic group. Besides accessible names this
 * deliberately uses field order as a conservative fallback: many real login
 * pages expose two anonymous textboxes even though their DOM input types are
 * perfectly descriptive.
 */
export function resolveLoginControls(snapshotText, overrides = {}) {
    const elements = parseSnapshotElements(snapshotText);
    const fields = elements.filter((element) => ['textbox', 'combobox'].includes(element.role));
    const buttons = elements.filter((element) => ['button', 'link'].includes(element.role));

    const explicitPassword = overridden(elements, overrides.password, 'password');
    const password = explicitPassword ?? fields
        .map((element) => ({ element, score: score(element, ['password', 'sifre', 'parola', 'passcode']) }))
        .sort((a, b) => b.score - a.score || a.element.index - b.element.index)
        .find((candidate) => candidate.score > 0)?.element
        ?? (fields.length === 2 ? fields[1] : null);

    const explicitUsername = overridden(elements, overrides.username ?? overrides.email, 'username');
    const username = explicitUsername ?? fields
        .filter((element) => element.uid !== password?.uid)
        .map((element) => ({
            element,
            score: score(element, ['email', 'e-mail', 'username', 'user name', 'kullanici', 'eposta', 'e-posta', 'login'])
        }))
        .sort((a, b) => b.score - a.score || a.element.index - b.element.index)
        .find((candidate) => candidate.score > 0)?.element
        ?? (fields.length === 2 ? fields.find((element) => element.uid !== password?.uid) : null);

    const explicitSubmit = overridden(elements, overrides.submit, 'submit');
    const submit = explicitSubmit ?? buttons
        .map((element) => ({
            element,
            score: loginSubmitScore(element)
        }))
        .sort((a, b) => b.score - a.score || a.element.index - b.element.index)
        .find((candidate) => candidate.score > 0)?.element
        ?? (buttons.length === 1 ? buttons[0] : null);

    return {
        usernameUid: username?.uid ?? null,
        passwordUid: password?.uid ?? null,
        submitUid: submit?.uid ?? null
    };
}

const COOKIE_CONTEXT = ['cookie', 'cookies', 'cerez', 'consent', 'privacy preference', 'gizlilik tercihi'];
const COOKIE_ACTIONS = [
    ['accept all', 100], ['allow all cookies', 100], ['tumunu kabul', 100], ['hepsini kabul', 100],
    ['cerezlere izin ver', 95], ['agree and continue', 90], ['kabul et ve devam', 90],
    ['i agree', 70], ['kabul et', 65]
];

/** Return only a consent action that is backed by explicit cookie context. */
export function findCookieConsentCandidate(snapshotText = '') {
    const foldedSnapshot = fold(snapshotText);
    if (!COOKIE_CONTEXT.some((term) => foldedSnapshot.includes(term))) return null;

    return parseSnapshotElements(snapshotText)
        .filter((element) => ['button', 'link'].includes(element.role))
        .map((element) => ({
            ...element,
            score: COOKIE_ACTIONS.reduce(
                (best, [term, weight]) => Math.max(best, element.folded.includes(term) ? weight : 0),
                0
            )
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)[0] ?? null;
}

export { fold as foldSnapshotText };
