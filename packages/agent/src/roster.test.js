import { describe, it, expect } from 'vitest';
import { buildRosterNote, buildTurnResponseInstruction, resolveSpeaker } from './roster.js';

describe('buildRosterNote', () => {
    it('is null with fewer than two named people', () => {
        expect(buildRosterNote([])).toBeNull();
        expect(buildRosterNote([{ identity: 'v1', name: 'Ali' }])).toBeNull();
        expect(buildRosterNote([{ identity: 'v1' }, { identity: 'v2' }])).toBeNull();
    });

    it('lists the names and tells the model to address people by name', () => {
        const note = buildRosterNote([
            { identity: 'v1', name: 'Ali' },
            { identity: 'v2', name: 'Ayşe' }
        ]);
        expect(note).toContain('Ali');
        expect(note).toContain('Ayşe');
        expect(note.toLowerCase()).toContain('by name');
    });
});

describe('buildTurnResponseInstruction', () => {
    it('is null when nothing meaningful is buffered', () => {
        expect(buildTurnResponseInstruction({ items: [] })).toBeNull();
        expect(buildTurnResponseInstruction({ items: [{ text: '  ' }] })).toBeNull();
    });

    it('open floor: answers everyone directly, by name', () => {
        const instr = buildTurnResponseInstruction({
            floor: null,
            items: [
                { speaker: 'Ali', text: 'Fiyat ne?' },
                { speaker: null, text: 'Deneme var mı?' }
            ]
        });
        expect(instr).toContain('Ali: Fiyat ne?');
        expect(instr).toContain('Deneme var mı?');
        expect(instr.toLowerCase()).toContain('addressing each asker by name');
        expect(instr.toLowerCase()).not.toContain('playbook');
    });

    it('with a floor-holder: folds chime-ins in, defers new topics to a raised hand, lists waiters', () => {
        const instr = buildTurnResponseInstruction({
            floor: { identity: 'visitor_a', name: 'Ali' },
            items: [{ speaker: 'Mehmet', text: 'Peki SSO?' }],
            hands: [{ identity: 'visitor_c', name: 'Can' }]
        });
        expect(instr).toContain('Ali currently has the floor');
        expect(instr.toLowerCase()).toContain('raise their hand');
        expect(instr).toContain('Can');
        expect(instr.toLowerCase()).toContain('do not switch to them yet');
    });
});

describe('resolveSpeaker', () => {
    const roster = [
        { identity: 'visitor_a', name: 'Ali' },
        { identity: 'visitor_b', name: 'Ayşe' }
    ];
    it('maps a known identity to its name, unknowns to null', () => {
        expect(resolveSpeaker(roster, 'visitor_a')).toBe('Ali');
        expect(resolveSpeaker(roster, 'visitor_z')).toBeNull();
        expect(resolveSpeaker(roster, null)).toBeNull();
    });
});
