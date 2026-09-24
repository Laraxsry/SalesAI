import { ConversationEventInput } from '@repo/contracts';

export class SalesOutcomePolicyError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SalesOutcomePolicyError';
        this.code = code;
    }
}

export function requireSessionContext(input) {
    const required = ['sessionId', 'workspaceId', 'agentId', 'productId'];
    const context = Object.fromEntries(required.map((field) => [field, String(input?.[field] ?? '').trim()]));
    if (required.some((field) => !context[field])) throw new SalesOutcomePolicyError('invalid_session_context');
    context.leadId = input?.leadId ? String(input.leadId) : null;
    context.participantIds = Array.isArray(input?.participantIds)
        ? [...new Set(input.participantIds.map((id) => String(id).trim()).filter(Boolean))]
        : [];
    return context;
}

export function requireTrustedParticipant(participantContext, participantId, sessionId) {
    if (!participantContext?.participantId
        || participantContext.attribution === 'unattributed'
        || participantContext.participantId !== participantId
        || participantContext.sessionId !== sessionId) {
        throw new SalesOutcomePolicyError('untrusted_participant_context');
    }
}

export async function requireEvent(eventReader, eventId, type) {
    if (!eventReader || typeof eventReader.getById !== 'function') {
        throw new TypeError('conversation event reader is required');
    }
    const raw = await eventReader.getById(eventId);
    const parsed = ConversationEventInput.safeParse(raw);
    if (!parsed.success || parsed.data.type !== type) {
        throw new SalesOutcomePolicyError(`missing_${type}_evidence`);
    }
    return parsed.data;
}

export function sameMembers(left, right) {
    return left.length === right.length
        && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
