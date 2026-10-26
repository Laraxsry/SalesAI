import { describe, expect, it } from 'vitest';
import { findCookieConsentCandidate, parseSnapshotElements, resolveLoginControls } from './chrome-snapshot.js';

describe('Chrome MCP snapshot semantics', () => {
    it('parses roles, names and UIDs without depending on tree indentation', () => {
        expect(parseSnapshotElements('  uid=4_2 textbox "E-posta adresi" required'))
            .toEqual([expect.objectContaining({ uid: '4_2', role: 'textbox', name: 'E-posta adresi' })]);
    });

    it('distinguishes a modal-opening Add from a form-submitting Add', () => {
        const elements = parseSnapshotElements([
            'uid=1_0 button "Add"',
            'uid=1_1 dialog "New asset"',
            '  uid=1_2 form',
            '    uid=1_3 textbox "Asset name"',
            '    uid=1_4 button "Add"'
        ].join('\n'));
        expect(elements.find((element) => element.uid === '1_0').insideForm).toBe(false);
        expect(elements.find((element) => element.uid === '1_4').insideForm).toBe(true);
    });

    it('resolves two anonymously named login fields by their form order', () => {
        expect(resolveLoginControls([
            'uid=1_1 textbox',
            'uid=1_2 textbox',
            'uid=1_3 button "Devam Et"'
        ].join('\n'))).toEqual({
            usernameUid: '1_1',
            passwordUid: '1_2',
            submitUid: '1_3'
        });
    });

    it('honours semantic overrides and reports invalid configuration', () => {
        const snapshot = 'uid=1_1 textbox "Kurum Kodu"\nuid=1_2 textbox "Parola"\nuid=1_3 button "Giriş"';
        expect(resolveLoginControls(snapshot, { username: 'Kurum Kodu' }).usernameUid).toBe('1_1');
        expect(() => resolveLoginControls(snapshot, { username: 'Bulunmayan' })).toThrow(/matched nothing/);
    });

    it('prefers the direct login action over a social continue button', () => {
        const snapshot = [
            'uid=1_1 textbox "Email"',
            'uid=1_2 textbox "Password"',
            'uid=1_3 button "Continue with Google"',
            'uid=1_4 button "Log in"'
        ].join('\n');
        expect(resolveLoginControls(snapshot).submitUid).toBe('1_4');
    });

    it('prefers the login form button over an identically named navigation link', () => {
        const snapshot = [
            'uid=1_0 link "Giriş Yap"',
            'uid=1_1 form',
            '  uid=1_2 textbox "Email"',
            '  uid=1_3 textbox "Password"',
            '  uid=1_4 button "Giriş Yap"'
        ].join('\n');
        expect(resolveLoginControls(snapshot).submitUid).toBe('1_4');
    });

    it('selects accept-all only when the snapshot has explicit cookie context', () => {
        const consent = [
            'uid=2_1 dialog "Çerez tercihleri"',
            'uid=2_2 button "Ayarlar"',
            'uid=2_3 button "Tümünü Kabul Et"'
        ].join('\n');
        expect(findCookieConsentCandidate(consent)).toMatchObject({ uid: '2_3', score: 100 });
        expect(findCookieConsentCandidate('uid=2_3 button "Kabul Et"')).toBeNull();
    });

    it('records the text of the row an element sits in', () => {
        const elements = parseSnapshotElements([
            'uid=1_0 table',
            '  uid=1_1 row',
            '    uid=1_2 cell "salesai-demo-abc12-name"',
            '    uid=1_3 button "Delete"',
            '  uid=1_4 row',
            '    uid=1_5 cell "Customer variable"',
            '    uid=1_6 button "Delete"'
        ].join('\n'));
        expect(elements.find((element) => element.uid === '1_3').rowText).toContain('salesai-demo-abc12-name');
        expect(elements.find((element) => element.uid === '1_6').rowText).not.toContain('salesai-demo');
    });

    it('falls back to a small container when there is no row role, but not to a whole page', () => {
        const elements = parseSnapshotElements([
            'uid=2_0 main',
            '  uid=2_1 generic',
            '    uid=2_2 text "salesai-demo-abc12-name"',
            '    uid=2_3 button "Delete"',
            ...Array.from({ length: 40 }, (_, number) => `  uid=2_${10 + number} link "Other ${number}"`)
        ].join('\n'));
        expect(elements.find((element) => element.uid === '2_3').rowText).toContain('salesai-demo-abc12-name');
        expect(elements.find((element) => element.uid === '2_20').rowText).toBe('');
    });
});
