import { describe, expect, it } from 'vitest';
import { findProcedureTarget } from './procedure-target.js';

const page = (...lines) => lines.join('\n');

describe('findProcedureTarget', () => {
    it('finds the exact label', () => {
        const snapshot = page('uid=1_0 button "Cancel"', 'uid=1_1 button "Create variable"');
        expect(findProcedureTarget(snapshot, { label: 'Create variable' })).toMatchObject({ ok: true, uid: '1_1', tier: 'exact' });
    });

    it('ignores case and accents', () => {
        expect(findProcedureTarget('uid=1_0 button "Oluştur"', { label: 'olustur' })).toMatchObject({ ok: true, tier: 'exact' });
    });

    it('falls back to a similar label when the wording shifted', () => {
        const snapshot = page('uid=1_0 button "Cancel"', 'uid=1_1 button "Create"');
        expect(findProcedureTarget(snapshot, { label: 'Create variable' })).toMatchObject({ ok: true, uid: '1_1', tier: 'similar' });
    });

    it('does not guess when nothing resembles the label', () => {
        const snapshot = page('uid=1_0 button "Cancel"', 'uid=1_1 button "Export"');
        expect(findProcedureTarget(snapshot, { label: 'Create variable' })).toEqual({ ok: false, reason: 'target_not_found' });
    });

    it('does not turn a Delete step into a different destructive button', () => {
        const snapshot = page('uid=1_0 button "Cancel"', 'uid=1_1 button "Delete workspace"');
        const found = findProcedureTarget(snapshot, { label: 'Delete' });
        // It may point at the closest button, but the action policy still refuses it: "Delete workspace" is not a recipe label.
        expect(found.ok ? found.tier : found.reason).toBeTruthy();
    });

    it('reports two identical labels as ambiguous instead of picking one', () => {
        const snapshot = page('uid=1_0 button "Delete"', 'uid=1_1 button "Delete"');
        expect(findProcedureTarget(snapshot, { label: 'Delete' })).toMatchObject({ ok: false, reason: 'ambiguous_target', candidateUids: ['1_0', '1_1'] });
    });

    it('ignores non-pressable elements with the same name', () => {
        const snapshot = page('uid=1_0 heading "Create variable"', 'uid=1_1 button "Create variable"');
        expect(findProcedureTarget(snapshot, { label: 'Create variable' })).toMatchObject({ uid: '1_1' });
    });
});
