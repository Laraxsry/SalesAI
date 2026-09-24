export function createMongoSalesOutcomeRepositories({ LeadContact, Meeting, FollowUpTask }) {
    if (!LeadContact || !Meeting || !FollowUpTask) {
        throw new TypeError('Mongo sales outcome models are required');
    }

    return Object.freeze({
        contacts: Object.freeze({
            async upsertConfirmed(record) {
                const filter = { sessionId: record.sessionId, participantId: record.participantId };
                const result = await LeadContact.updateOne(filter, {
                    $setOnInsert: {
                        sessionId: record.sessionId,
                        workspaceId: record.workspaceId,
                        agentId: record.agentId,
                        productId: record.productId,
                        leadId: record.leadId,
                        participantId: record.participantId
                    },
                    $set: {
                        [`contact.${record.field}`]: record.value,
                        [`confirmationRefs.${record.field}`]: {
                            sourceEventId: record.sourceEventId,
                            confirmationEventId: record.confirmationEventId,
                            confirmedAt: record.confirmedAt
                        }
                    }
                }, { upsert: true, runValidators: true });
                const document = await LeadContact.findOne(filter).select('_id').lean();
                return { id: String(document._id), created: result.upsertedCount === 1 };
            }
        }),
        meetings: Object.freeze({
            async saveConfirmed(record) {
                const filter = {
                    sessionId: record.sessionId,
                    confirmationEventId: record.confirmationEventId
                };
                const result = await Meeting.updateOne(filter, { $setOnInsert: record }, {
                    upsert: true, runValidators: true
                });
                const document = await Meeting.findOne(filter).select('_id').lean();
                return { id: String(document._id), created: result.upsertedCount === 1 };
            }
        }),
        followUps: Object.freeze({
            async createFromQuestion(record) {
                const filter = { sessionId: record.sessionId, sourceEventId: record.sourceEventId };
                const result = await FollowUpTask.updateOne(filter, {
                    $setOnInsert: { ...record, status: 'pending' }
                }, { upsert: true, runValidators: true });
                const document = await FollowUpTask.findOne(filter).select('_id').lean();
                return { id: String(document._id), created: result.upsertedCount === 1 };
            }
        })
    });
}
