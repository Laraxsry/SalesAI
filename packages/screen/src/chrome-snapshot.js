function fold(value = '') {
    return value
        .toLocaleLowerCase('tr')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i');
}

/** Parse the stable subset of Chrome DevTools MCP's accessibility snapshot. */
export function parseSnapshotElements(snapshotText = '') {
    return snapshotText.split('\n').flatMap((line, index) => {
        const uid = line.match(/\buid=([^\s]+)/)?.[1];
        if (!uid) return [];
        const afterUid = line.slice(line.indexOf(`uid=${uid}`) + uid.length + 4).trim();
        const role = afterUid.match(/^([\w-]+)/)?.[1]?.toLowerCase() ?? '';
        const name = afterUid.match(/^[\w-]+\s+"([^"]*)"/)?.[1] ?? '';
        return [{ uid, role, name, line, index, folded: fold(`${role} ${name} ${line}`) }];
    });
}

export function snapshotElementByUid(snapshotText, uid) {
    return parseSnapshotElements(snapshotText).find((element) => element.uid === uid) ?? null;
}

function score(element, terms) {
    return terms.reduce((total, term) => total + (element.folded.includes(term) ? 1 : 0), 0);
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
            score: score(element, ['sign in', 'log in', 'login', 'giris', 'oturum ac', 'devam et', 'continue'])
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
