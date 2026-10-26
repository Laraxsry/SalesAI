import { afterEach, describe, expect, it } from 'vitest';
import { loginProbe, verificationScript } from './chrome-login.js';

const originalDocument = globalThis.document;
const originalGetComputedStyle = globalThis.getComputedStyle;

afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
});

function reactLoginControls() {
    const body = { tagName: 'BODY', parentElement: null };
    const card = {
        tagName: 'DIV',
        parentElement: body,
        contains: (node) => node?.parentElement === card
    };
    const control = (fields) => ({
        isConnected: true,
        disabled: false,
        readOnly: false,
        form: null,
        parentElement: card,
        getClientRects: () => [{}],
        matches: () => true,
        checkValidity: () => true,
        ...fields
    });
    const username = control({ tagName: 'INPUT', type: 'email', value: '', autocomplete: 'username' });
    const password = control({ tagName: 'INPUT', type: 'password', value: '' });
    const social = control({ tagName: 'BUTTON', type: 'button' });
    const submit = control({ tagName: 'BUTTON', type: 'button' });
    return { username, password, social, submit };
}

describe('Chrome MCP login DOM guards', () => {
    it('accepts a React login card without a native form and selects Log in over Google', () => {
        const controls = reactLoginControls();
        globalThis.document = {
            querySelectorAll: () => [controls.password]
        };
        globalThis.getComputedStyle = () => ({ visibility: 'visible' });
        const probe = loginProbe([
            'uid=1_1 textbox "Email"',
            'uid=1_2 textbox "Password"',
            'uid=1_3 button "Continue with Google"',
            'uid=1_4 button "Log in"'
        ].join('\n'));
        const byUid = {
            '1_1': controls.username,
            '1_2': controls.password,
            '1_3': controls.social,
            '1_4': controls.submit
        };
        const evaluate = Function(`return (${probe.function})`)();

        expect(evaluate(...probe.uids.map((uid) => byUid[uid]))).toEqual({
            indices: [0, 1, 3],
            association: 'shared_container'
        });
    });

    it('still refuses controls that only meet at the page body', () => {
        const controls = reactLoginControls();
        const body = { tagName: 'BODY', parentElement: null, contains: () => true };
        controls.username.parentElement = { tagName: 'DIV', parentElement: body, contains: (node) => node === controls.username };
        controls.password.parentElement = { tagName: 'DIV', parentElement: body, contains: (node) => node === controls.password };
        controls.submit.parentElement = { tagName: 'DIV', parentElement: body, contains: (node) => node === controls.submit };
        globalThis.document = { querySelectorAll: () => [controls.password] };
        globalThis.getComputedStyle = () => ({ visibility: 'visible' });
        const probe = loginProbe('uid=1_1 textbox "Email"\nuid=1_2 textbox "Password"\nuid=1_3 button "Log in"');
        const evaluate = Function(`return (${probe.function})`)();

        expect(evaluate(controls.username, controls.password, controls.submit).error)
            .toMatch(/not grouped/);
    });

    it('verifies filled values inside the same non-form login container', () => {
        const controls = reactLoginControls();
        controls.username.value = 'demo@example.test';
        controls.password.value = 'secret';
        const verify = Function(`return (${verificationScript('demo@example.test', 'secret')})`)();

        expect(verify(controls.username, controls.password, controls.submit)).toMatchObject({
            sameForm: false,
            sameLoginGroup: true,
            usernameMatches: true,
            passwordMatches: true,
            valid: true
        });
    });
});
