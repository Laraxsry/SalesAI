import { AnalystProposalInput } from '@repo/contracts';

function rejection(code) {
    return { code };
}

/** Deterministic authority boundary for untrusted analyst output. */
export function createAnalystProposalValidator({ now = () => Date.now() } = {}) {
    const acceptedIdempotencyKeys = new Set();

    return Object.freeze({
        validateAndReserve({ proposal, event, currentContext }) {
            const parsed = AnalystProposalInput.safeParse(proposal);
            if (!parsed.success) {
                return { accepted: false, errors: [rejection('invalid_proposal')] };
            }
            const normalized = parsed.data;
            const errors = [];
            if (normalized.sessionId !== event.sessionId) errors.push(rejection('session_mismatch'));
            if (normalized.participantId !== null
                && normalized.participantId !== event.participantId) {
                errors.push(rejection('participant_mismatch'));
            }
            if (!normalized.sourceEventIds.includes(event.eventId)) {
                errors.push(rejection('source_event_missing'));
            }
            if (normalized.baseMemoryRevision !== currentContext.memoryRevision) {
                errors.push(rejection('stale_memory_revision'));
            }
            if (normalized.baseRouteRevision !== currentContext.routeRevision) {
                errors.push(rejection('stale_route_revision'));
            }
            if (normalized.turnIndex !== currentContext.turnIndex) {
                errors.push(rejection('stale_turn'));
            }
            if (Date.parse(normalized.expiresAt) <= now()) errors.push(rejection('expired'));
            if (acceptedIdempotencyKeys.has(normalized.idempotencyKey)) {
                errors.push(rejection('duplicate'));
            }
            if (errors.length > 0) return { accepted: false, errors };

            acceptedIdempotencyKeys.add(normalized.idempotencyKey);
            return { accepted: true, proposal: normalized, errors: [] };
        },
        hasAccepted(idempotencyKey) {
            return acceptedIdempotencyKeys.has(idempotencyKey);
        }
    });
}
