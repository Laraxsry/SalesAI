import { describe, expect, it, vi } from 'vitest';
import { createCapabilityRequestService } from './capability-request-service.js';

const request = {
    requestedOutcome: 'Banka ekstresini API üzerinden çekmek',
    customerContext: 'Her ay manuel PDF yüklüyor',
    sourceIntentId: 'knowledge:abcd',
    evidenceStatus: 'not_found',
    consentToContact: true,
    prioritySignals: ['high_frequency']
};

describe('createCapabilityRequestService', () => {
    it('persists a validated, consented request', async () => {
        const persist = vi.fn().mockResolvedValue({ id: 'task-1' });
        const onCaptured = vi.fn();
        const service = createCapabilityRequestService({ persist, onCaptured });

        await expect(service.capture(request)).resolves.toEqual({ ok: true, requestId: 'task-1' });
        expect(persist).toHaveBeenCalledWith(request);
        expect(onCaptured).toHaveBeenCalledWith({ request, id: 'task-1' });
    });

    it('rejects missing consent before persistence', async () => {
        const persist = vi.fn();
        const service = createCapabilityRequestService({ persist });

        await expect(service.capture({ ...request, consentToContact: false })).resolves.toEqual({
            ok: false,
            error: 'explicit_consent_required'
        });
        expect(persist).not.toHaveBeenCalled();
    });

    it('does not let an observer failure rewrite a successful capture', async () => {
        const service = createCapabilityRequestService({
            persist: vi.fn().mockResolvedValue('task-1'),
            onCaptured: () => { throw new Error('timeline down'); }
        });

        await expect(service.capture(request)).resolves.toEqual({ ok: true, requestId: 'task-1' });
    });
});
