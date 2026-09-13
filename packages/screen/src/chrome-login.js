import { parseSnapshotElements } from './chrome-snapshot.js';

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
            const password = choose('password', passwords);
            if (!password?.form) return { error: 'A unique password field with a native form is required.' };
            const form = password.form;
            const fields = Array.from(form.elements).filter(usable);
            let usernames = fields.filter(el => el.tagName === 'INPUT' && ['email', 'text', 'tel'].includes(el.type) && !el.readOnly);
            if (!selectors.username && !selectors.email && hints.username === undefined) {
                const named = usernames.filter(el => el.type === 'email' || el.autocomplete === 'username' || /^(email|username|user|login)$/i.test(el.name || el.id));
                if (named.length) usernames = named;
            }
            const username = choose('username', usernames);
            const submit = choose('submit', fields.filter(el => ['BUTTON', 'INPUT'].includes(el.tagName) && el.type === 'submit'));
            if (!username || !submit) return { error: 'A unique username field and submit control in the password form are required; configure demoSession.selectors.' };
            const indices = [username, password, submit].map(el => elements.indexOf(el));
            if (indices.includes(-1)) return { error: 'Login controls are missing from the live accessibility snapshot.' };
            return { indices };
        }`
    };
}

export function verificationScript(username, password) {
    return `(user, pass, submit) => ({
        sameForm: Boolean(user.isConnected && pass.isConnected && submit.isConnected && pass.form && user.form === pass.form && submit.form === pass.form && submit.type === 'submit' && !submit.disabled),
        usernameMatches: user.value === ${JSON.stringify(username)},
        passwordMatches: pass.value === ${JSON.stringify(password)},
        valid: Boolean(user.form?.checkValidity())
    })`;
}

export const LOGIN_STATUS_SCRIPT = `() => ({
    passwordVisible: Array.from(document.querySelectorAll('input[type="password"]')).some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'),
    hasError: Array.from(document.querySelectorAll('[role="alert"], #Label_HATA, .validation-summary-errors, .text-danger')).some(el => el.getClientRects().length > 0 && el.textContent.trim().length > 0)
})`;
