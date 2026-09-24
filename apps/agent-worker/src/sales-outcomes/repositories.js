function clone(value) {
    return value === null || value === undefined ? value : structuredClone(value);
}

export function createInMemoryConversationEventReader(initialEvents = []) {
    const events = new Map(initialEvents.map((event) => [event.eventId, clone(event)]));
    return Object.freeze({
        add(event) {
            events.set(event.eventId, clone(event));
        },
        async getById(eventId) {
            return clone(events.get(eventId) ?? null);
        }
    });
}

export function createInMemorySalesOutcomeRepositories() {
    const contacts = new Map();
    const meetings = new Map();
    const followUps = new Map();

    return Object.freeze({
        contacts: Object.freeze({
            async upsertConfirmed(record) {
                const key = `${record.sessionId}:${record.participantId}`;
                const current = contacts.get(key) ?? {
                    sessionId: record.sessionId,
                    workspaceId: record.workspaceId,
                    agentId: record.agentId,
                    productId: record.productId,
                    leadId: record.leadId,
                    participantId: record.participantId,
                    contact: {},
                    confirmationRefs: {}
                };
                const duplicate = current.confirmationRefs[record.field]?.confirmationEventId
                    === record.confirmationEventId;
                if (!duplicate) {
                    current.contact[record.field] = record.value;
                    current.confirmationRefs[record.field] = {
                        sourceEventId: record.sourceEventId,
                        confirmationEventId: record.confirmationEventId,
                        confirmedAt: record.confirmedAt
                    };
                    contacts.set(key, current);
                }
                return { id: key, created: !duplicate };
            },
            async list() {
                return clone([...contacts.values()]);
            }
        }),
        meetings: Object.freeze({
            async saveConfirmed(record) {
                const key = `${record.sessionId}:${record.confirmationEventId}`;
                const created = !meetings.has(key);
                if (created) meetings.set(key, clone(record));
                return { id: key, created };
            },
            async list() {
                return clone([...meetings.values()]);
            }
        }),
        followUps: Object.freeze({
            async createFromQuestion(record) {
                const key = `${record.sessionId}:${record.sourceEventId}`;
                const created = !followUps.has(key);
                if (created) followUps.set(key, clone(record));
                return { id: key, created };
            },
            async list() {
                return clone([...followUps.values()]);
            }
        })
    });
}
