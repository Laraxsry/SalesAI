import { describe, expect, it } from 'vitest';
import { createParticipantScopedMemory } from './memory-state.js';
import { reduceParticipantScopedMemory } from './memory-reducer.js';
import { projectSpeakingAgentMemory } from './memory-projector.js';

function acceptedEvent(overrides = {}) {
    return {
        eventId: 'accepted-1',
        sourceEventId: 'source-1',
        turnIndex: 1,
        type: 'participant_interest_accepted',
        participantId: 'participant-ali',
        payload: { interest: 'güvenlik' },
        ...overrides
    };
}

describe('participant-scoped memory reducer', () => {
    it('keeps participant facts isolated', () => {
        const initial = createParticipantScopedMemory();
        const ali = reduceParticipantScopedMemory(initial, acceptedEvent());
        const ayse = reduceParticipantScopedMemory(ali, acceptedEvent({
            eventId: 'accepted-2',
            participantId: 'participant-ayse',
            payload: { interest: 'raporlama' }
        }));

        expect(ayse.participants['participant-ali'].interests).toEqual(['güvenlik']);
        expect(ayse.participants['participant-ayse'].interests).toEqual(['raporlama']);
    });

    it('is idempotent for the same accepted event', () => {
        const first = reduceParticipantScopedMemory(createParticipantScopedMemory(), acceptedEvent());
        const duplicate = reduceParticipantScopedMemory(first, acceptedEvent());

        expect(duplicate).toBe(first);
        expect(duplicate.revision).toBe(1);
        expect(duplicate.participants['participant-ali'].interests).toEqual(['güvenlik']);
    });

    it('records shared memory without copying it into each participant', () => {
        const next = reduceParticipantScopedMemory(createParticipantScopedMemory(), acceptedEvent({
            type: 'shared_question_opened',
            participantId: null,
            payload: { question: 'Veriler hangi ülkede tutuluyor?' }
        }));

        expect(next.shared.openQuestions).toEqual(['Veriler hangi ülkede tutuluyor?']);
        expect(next.participants).toEqual({});
    });

    it('refuses malformed contact values at the reducer boundary', () => {
        const initial = createParticipantScopedMemory();
        const next = reduceParticipantScopedMemory(initial, acceptedEvent({
            type: 'participant_contact_confirmed',
            payload: { field: 'email', value: 'not-an-email' }
        }));

        expect(next).toBe(initial);
        expect(next.participants['participant-ali']).toBeUndefined();
    });

    it('projects only the active participant and excludes contact and consent PII', () => {
        let memory = reduceParticipantScopedMemory(createParticipantScopedMemory(), acceptedEvent());
        memory = reduceParticipantScopedMemory(memory, acceptedEvent({
            eventId: 'accepted-2',
            type: 'participant_contact_confirmed',
            payload: { field: 'email', value: 'ali@example.com' }
        }));
        memory = reduceParticipantScopedMemory(memory, acceptedEvent({
            eventId: 'accepted-3',
            participantId: 'participant-ayse',
            payload: { interest: 'raporlama' }
        }));

        const projection = projectSpeakingAgentMemory(memory, 'participant-ali');
        const serialized = JSON.stringify(projection);

        expect(projection.activeParticipant).toMatchObject({
            participantId: 'participant-ali', interests: ['güvenlik']
        });
        expect(serialized).not.toContain('raporlama');
        expect(serialized).not.toContain('ali@example.com');
        expect(serialized).not.toContain('confirmedContact');
        expect(serialized).not.toContain('consent');
    });
});
