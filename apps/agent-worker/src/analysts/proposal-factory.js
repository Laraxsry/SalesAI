import { randomUUID } from 'node:crypto';

export function createAnalystProposalFactory({
    createId = () => randomUUID(),
    now = () => Date.now(),
    ttlMs = 30000
} = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 300000) {
        throw new TypeError('proposal ttlMs is invalid');
    }

    return ({ analyst, event, context, proposalType, payload }) => ({
        proposalId: createId(),
        analystId: analyst.id,
        analystVersion: analyst.version,
        sessionId: event.sessionId,
        participantId: event.participantId,
        sourceEventIds: [event.eventId],
        baseMemoryRevision: context.memoryRevision,
        baseRouteRevision: context.routeRevision,
        turnIndex: event.turnIndex,
        confidence: payload.confidence,
        idempotencyKey: `${analyst.id}:${event.eventId}:${proposalType}`,
        expiresAt: new Date(now() + ttlMs).toISOString(),
        proposalType,
        payload: payload.value
    });
}
