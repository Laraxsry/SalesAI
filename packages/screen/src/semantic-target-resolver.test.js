import { describe, expect, it } from 'vitest';
import { resolveSnapshotTarget } from './semantic-target-resolver.js';

describe('semantic snapshot target resolver', () => {
    it('resolves a planner phrase without persisting selectors or UIDs', () => {
        const snapshot = [
            'uid=22_1 heading "Finans Merkezi"',
            'uid=22_2 button "Ekstre Yükle"',
            'uid=22_3 link "Raporlar"'
        ].join('\n');
        expect(resolveSnapshotTarget(snapshot, {
            target: 'Ekstre yükleme alanı', intent: 'focus'
        })).toMatchObject({ ok: true, uid: '22_2', name: 'Ekstre Yükle' });
    });

    it('rejects equally strong ambiguous matches', () => {
        const snapshot = [
            'uid=1 button "Ayarlar"',
            'uid=2 button "Ayarlar"'
        ].join('\n');
        expect(resolveSnapshotTarget(snapshot, { target: 'Ayarlar', intent: 'click' }))
            .toMatchObject({ ok: false, reason: 'ambiguous_target' });
    });

    it('does not guess when semantic evidence is weak', () => {
        expect(resolveSnapshotTarget('uid=1 button "Sil"', {
            target: 'Ekstre yükle', intent: 'click'
        })).toEqual({ ok: false, reason: 'target_not_found' });
    });
});
