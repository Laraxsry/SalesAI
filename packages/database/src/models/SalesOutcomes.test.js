import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { FollowUpTask } from './FollowUpTask.js';
import { LeadContact } from './LeadContact.js';
import { Meeting } from './Meeting.js';

const id = () => new Types.ObjectId();

describe('additive sales outcome models', () => {
    it('validates participant-aware contact and meeting documents without a database', async () => {
        const contact = new LeadContact({
            sessionId: id(), workspaceId: id(), agentId: id(), productId: id(),
            participantId: 'participant-1',
            contact: { email: 'ali@example.com' },
            confirmationRefs: {
                email: {
                    sourceEventId: 'source-1',
                    confirmationEventId: 'confirmation-1',
                    confirmedAt: new Date()
                }
            }
        });
        const meeting = new Meeting({
            sessionId: id(), workspaceId: id(), agentId: id(), productId: id(),
            attendeeParticipantIds: ['participant-1'],
            startsAt: new Date(), timezone: 'Europe/Brussels', durationMinutes: 30,
            originalPhrase: 'Perşembe üçte', sourceEventId: 'intent-1',
            confirmationEventId: 'confirmation-1'
        });

        await expect(contact.validate()).resolves.toBeUndefined();
        await expect(meeting.validate()).resolves.toBeUndefined();
    });

    it('keeps the legacy follow-up shape valid while accepting participant metadata', async () => {
        const legacy = new FollowUpTask({
            sessionId: id(), agentId: id(), question: 'Legacy question'
        });
        const participantAware = new FollowUpTask({
            sessionId: id(), agentId: id(), workspaceId: id(), productId: id(),
            requestedByParticipantId: 'participant-1', sourceEventId: 'question-1',
            forwardingConsentEventId: 'consent-1', question: 'New question'
        });

        await expect(legacy.validate()).resolves.toBeUndefined();
        await expect(participantAware.validate()).resolves.toBeUndefined();
    });
});
