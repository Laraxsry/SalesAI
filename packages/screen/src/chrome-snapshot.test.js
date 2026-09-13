import { describe, expect, it } from 'vitest';
import { findCookieConsentCandidate, parseSnapshotElements, resolveLoginControls } from './chrome-snapshot.js';

describe('Chrome MCP snapshot semantics', () => {
    it('parses roles, names and UIDs without depending on tree indentation', () => {
        expect(parseSnapshotElements('  uid=4_2 textbox "E-posta adresi" required'))
            .toEqual([expect.objectContaining({ uid: '4_2', role: 'textbox', name: 'E-posta adresi' })]);
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

    it('selects accept-all only when the snapshot has explicit cookie context', () => {
        const consent = [
            'uid=2_1 dialog "Çerez tercihleri"',
            'uid=2_2 button "Ayarlar"',
            'uid=2_3 button "Tümünü Kabul Et"'
        ].join('\n');
        expect(findCookieConsentCandidate(consent)).toMatchObject({ uid: '2_3', score: 100 });
        expect(findCookieConsentCandidate('uid=2_3 button "Kabul Et"')).toBeNull();
    });
});
