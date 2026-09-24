import { describe, expect, it } from 'vitest';
import { createParticipantRegistry } from '../participants/participant-registry.js';
import { createInMemorySalesOutcomeRepositories } from './repositories.js';
import { createLiveSalesOutcomeRuntime } from './live-sales-outcome-runtime.js';

function fixture(overrides = {}) {
    const repositories = createInMemorySalesOutcomeRepositories();
    const registry = createParticipantRegistry({
        sessionId: 'session-1',
        initialParticipants: [
            { participantId: 'p-ali', identity: 'visitor-ali', name: 'Ali' },
            { participantId: 'p-ayse', identity: 'visitor-ayse', name: 'Ayşe' }
        ]
    });
    let counter = 0;
    const runtime = createLiveSalesOutcomeRuntime({
        repositories,
        sessionContext: {
            sessionId: 'session-1', workspaceId: 'workspace-1',
            agentId: 'agent-1', productId: 'product-1'
        },
        participantRegistry: registry,
        getParticipantContext: () => ({
            sessionId: 'session-1', participantId: 'p-ali',
            livekitIdentity: 'visitor-ali', attribution: 'event_speaker'
        }),
        createEventId: () => `event-${++counter}`,
        now: () => Date.parse('2026-09-22T12:00:00.000Z'),
        ...overrides
    });
    return { runtime, repositories };
}

describe('live sales outcome runtime', () => {
    it('persists participant-aware contact without returning its PII', async () => {
        const { runtime, repositories } = fixture();
        const result = await runtime.confirmContact({ field: 'email', value: 'ali@example.com' });
        expect(result).toMatchObject({ ok: true, created: true });
        expect(JSON.stringify(result)).not.toContain('ali@example.com');
        expect(await repositories.contacts.list()).toMatchObject([{
            participantId: 'p-ali', contact: { email: 'ali@example.com' }
        }]);
    });

    it('persists a confirmed meeting for connected participants', async () => {
        const { runtime, repositories } = fixture();
        await expect(runtime.confirmMeeting({
            startsAt: '2026-09-24T13:00:00.000Z',
            timezone: 'Europe/Brussels',
            durationMinutes: 30,
            originalPhrase: 'Perşembe saat üç'
        })).resolves.toMatchObject({ ok: true, created: true });
        expect(await repositories.meetings.list()).toMatchObject([{
            attendeeParticipantIds: ['p-ali', 'p-ayse']
        }]);
    });

    it('uses an accepted classifier category for each consented company question', async () => {
        const { runtime, repositories } = fixture({
            publishAnalysis: async () => [{ status: 'fulfilled', value: [{
                status: 'accepted',
                proposal: {
                    proposalType: 'follow_up_classification',
                    payload: { category: 'security' }
                }
            }] }]
        });
        await runtime.captureFollowUp({ question: 'Veriler hangi ülkede tutuluyor?' });
        expect(await repositories.followUps.list()).toMatchObject([{
            requestedByParticipantId: 'p-ali', category: 'security'
        }]);
    });

    it('refuses writes when participant attribution is unavailable', async () => {
        const { runtime } = fixture({ getParticipantContext: () => null });
        await expect(runtime.confirmContact({ field: 'name', value: 'Ali' }))
            .resolves.toEqual({ ok: false, error: 'trusted_participant_required' });
    });
});
