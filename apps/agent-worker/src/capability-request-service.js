import { CapabilityRequestInput } from '@repo/contracts';

/**
 * Application service around the capability-request persistence port. Domain
 * validation stays independent of Mongo/FollowUpTask so the storage target can
 * later change without changing tool or planner code.
 *
 * @param {object} deps
 * @param {(request:object)=>Promise<{id:string}|string>} deps.persist
 * @param {(result:{request:object,id:string})=>void} [deps.onCaptured]
 */
export function createCapabilityRequestService({ persist, onCaptured = () => {} }) {
    if (typeof persist !== 'function') throw new TypeError('persist port is required');

    return {
        async capture(input) {
            const parsed = CapabilityRequestInput.safeParse(input);
            if (!parsed.success) {
                const consentMissing = input?.consentToContact !== true;
                return {
                    ok: false,
                    error: consentMissing ? 'explicit_consent_required' : 'invalid_capability_request'
                };
            }

            const persisted = await persist(parsed.data);
            const id = typeof persisted === 'string' ? persisted : persisted?.id;
            if (!id) throw new Error('capability request persistence returned no id');

            try {
                onCaptured({ request: parsed.data, id: String(id) });
            } catch {
                // Observability/state projection is not allowed to turn a
                // successful durable write into a customer-visible failure.
            }
            return { ok: true, requestId: String(id) };
        }
    };
}
