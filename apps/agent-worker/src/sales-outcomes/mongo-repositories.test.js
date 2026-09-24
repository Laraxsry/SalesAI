import { describe, expect, it, vi } from 'vitest';
import { createMongoSalesOutcomeRepositories } from './mongo-repositories.js';

function model(id) {
    return {
        updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
        findOne: vi.fn().mockReturnValue({
            select: () => ({ lean: async () => ({ _id: id }) })
        })
    };
}

describe('Mongo sales outcome repository adapters', () => {
    it('uses additive idempotent upserts for every outcome', async () => {
        const LeadContact = model('contact-id');
        const Meeting = model('meeting-id');
        const FollowUpTask = model('follow-up-id');
        const repositories = createMongoSalesOutcomeRepositories({
            LeadContact, Meeting, FollowUpTask
        });

        await repositories.contacts.upsertConfirmed({
            sessionId: 'session-1', participantId: 'participant-1',
            workspaceId: 'workspace-1', agentId: 'agent-1', productId: 'product-1',
            leadId: null, field: 'email', value: 'ali@example.com',
            sourceEventId: 'source-1', confirmationEventId: 'confirmation-1',
            confirmedAt: new Date()
        });
        await repositories.meetings.saveConfirmed({
            sessionId: 'session-1', confirmationEventId: 'meeting-confirmation-1'
        });
        await repositories.followUps.createFromQuestion({
            sessionId: 'session-1', sourceEventId: 'question-1', question: 'Soru'
        });

        expect(LeadContact.updateOne).toHaveBeenCalledWith(
            { sessionId: 'session-1', participantId: 'participant-1' },
            expect.objectContaining({
                $set: expect.objectContaining({ 'contact.email': 'ali@example.com' })
            }),
            expect.objectContaining({ upsert: true })
        );
        expect(Meeting.updateOne).toHaveBeenCalledWith(
            { sessionId: 'session-1', confirmationEventId: 'meeting-confirmation-1' },
            expect.anything(),
            expect.objectContaining({ upsert: true })
        );
        expect(FollowUpTask.updateOne).toHaveBeenCalledWith(
            { sessionId: 'session-1', sourceEventId: 'question-1' },
            expect.anything(),
            expect.objectContaining({ upsert: true })
        );
    });
});
