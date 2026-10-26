import { parseSnapshotElements, resolveLoginControls } from './chrome-snapshot.js';

// Only DOM metadata leaves the page. Credentials are never returned by probes.
export function loginProbe(snapshot, auth = {}) {
    const elements = parseSnapshotElements(snapshot).filter(({ role }) =>
        ['textbox', 'combobox', 'button', 'link'].includes(role));
    const hints = {};
    for (const field of ['username', 'password', 'submit']) {
        const pattern = auth.mcpSelectors?.[field] ?? (field === 'username' ? auth.mcpSelectors?.email : null);
        if (!pattern) continue;
        const regex = new RegExp(pattern, 'i');
        const matches = elements.flatMap((element, index) => regex.test(element.line) ? [index] : []);
        if (matches.length !== 1) throw new Error(`[ChromeMcpTour] mcpSelectors.${field} matched ${matches.length ? 'multiple controls' : 'nothing'} in the live snapshot.`);
        hints[field] = matches[0];
    }
    const semantic = resolveLoginControls(snapshot);
    const semanticUids = {
        username: semantic.usernameUid,
        password: semantic.passwordUid,
        submit: semantic.submitUid
    };
    for (const field of ['username', 'password', 'submit']) {
        const selector = auth.selectors?.[field]
            ?? (field === 'username' ? auth.selectors?.email : null);
        if (hints[field] !== undefined || selector || !semanticUids[field]) continue;
        const index = elements.findIndex(({ uid }) => uid === semanticUids[field]);
        if (index >= 0) hints[field] = index;
    }
    return {
        uids: elements.map(({ uid }) => uid),
        function: `(...elements) => {
            const selectors = ${JSON.stringify(auth.selectors ?? {})};
            const hints = ${JSON.stringify(hints)};
            const visible = el => el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
            const usable = el => visible(el) && !el.disabled;
            const choose = (field, candidates) => {
                const selector = selectors[field] || (field === 'username' ? selectors.email : null);
                if (selector) candidates = candidates.filter(el => el.matches(selector));
                if (hints[field] !== undefined) candidates = candidates.filter(el => el === elements[hints[field]]);
                return candidates.length === 1 ? candidates[0] : null;
            };
            const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(usable);
            if (!selectors.password && hints.password === undefined && passwords.length !== 1) {
                return { error: 'A unique visible password field is required.' };
            }
            const password = choose('password', passwords);
            if (!password) return { error: 'A unique visible password field is required.' };
            let usernames = elements.filter(el => usable(el) && el.tagName === 'INPUT' && ['email', 'text', 'tel'].includes(el.type) && !el.readOnly);
            if (!selectors.username && !selectors.email && hints.username === undefined) {
                const named = usernames.filter(el => el.type === 'email' || el.autocomplete === 'username' || /^(email|username|user|login)$/i.test(el.name || el.id));
                if (named.length) usernames = named;
            }
            const username = choose('username', usernames);
            const submit = choose('submit', elements.filter(el => usable(el) && ['BUTTON', 'INPUT'].includes(el.tagName)));
            if (!username || !submit) return { error: 'A unique username field and login control are required; configure demoSession selectors.' };
            const sameNativeForm = Boolean(password.form && username.form === password.form && submit.form === password.form);
            const nearestCommonContainer = nodes => {
                let current = nodes[0]?.parentElement;
                while (current && !['BODY', 'HTML'].includes(current.tagName)) {
                    if (nodes.every(node => current.contains(node))) return current;
                    current = current.parentElement;
                }
                return null;
            };
            const sharedContainer = sameNativeForm ? password.form : nearestCommonContainer([username, password, submit]);
            if (!sharedContainer) return { error: 'Login controls are not grouped in one native form or visible login container.' };
            const indices = [username, password, submit].map(el => elements.indexOf(el));
            if (indices.includes(-1)) return { error: 'Login controls are missing from the live accessibility snapshot.' };
            return { indices, association: sameNativeForm ? 'native_form' : 'shared_container' };
        }`
    };
}

export function verificationScript(username, password) {
    return `(user, pass, submit) => {
        const connected = Boolean(user.isConnected && pass.isConnected && submit.isConnected && !submit.disabled);
        const sameNativeForm = Boolean(connected && pass.form && user.form === pass.form && submit.form === pass.form);
        const nearestCommonContainer = nodes => {
            let current = nodes[0]?.parentElement;
            while (current && !['BODY', 'HTML'].includes(current.tagName)) {
                if (nodes.every(node => current.contains(node))) return current;
                current = current.parentElement;
            }
            return null;
        };
        const sameLoginGroup = Boolean(connected && (sameNativeForm || nearestCommonContainer([user, pass, submit])));
        const controlsValid = [user, pass].every(control =>
            typeof control.checkValidity !== 'function' || control.checkValidity());
        return {
            sameForm: sameNativeForm,
            sameLoginGroup,
            usernameMatches: user.value === ${JSON.stringify(username)},
            passwordMatches: pass.value === ${JSON.stringify(password)},
            valid: Boolean(controlsValid && (!sameNativeForm || user.form.checkValidity()))
        };
    }`;
}

export const LOGIN_STATUS_SCRIPT = `() => ({
    passwordVisible: Array.from(document.querySelectorAll('input[type="password"]')).some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'),
    hasError: Array.from(document.querySelectorAll('[role="alert"], #Label_HATA, .validation-summary-errors, .text-danger')).some(el => el.getClientRects().length > 0 && el.textContent.trim().length > 0)
})`;
