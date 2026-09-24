import { describe, expect, it, vi } from 'vitest';
import { createAnswerFirstDemoCoordinator } from './answer-first-demo-coordinator.js';

describe('answer-first demo coordinator', () => {
    it('does not execute until spoken answer delivery completes', async () => {
        const executor = {
            execute: vi.fn(async () => ({ status: 'completed' })),
            cancel: vi.fn()
        };
        const coordinator = createAnswerFirstDemoCoordinator({ executor });
        coordinator.schedule({ id: 'demo' }, { routeRevision: 1 });
        expect(executor.execute).not.toHaveBeenCalled();

        await coordinator.answerDelivered();
        expect(executor.execute).toHaveBeenCalledWith(
            { id: 'demo' }, { routeRevision: 1 }
        );
    });

    it('cancels pending choreography when the customer interrupts', async () => {
        const executor = { execute: vi.fn(), cancel: vi.fn() };
        const coordinator = createAnswerFirstDemoCoordinator({ executor });
        coordinator.schedule({ id: 'demo' }, { routeRevision: 1 });
        coordinator.cancel('customer_interrupted');

        expect(coordinator.hasPending()).toBe(false);
        expect(executor.cancel).toHaveBeenCalledWith('customer_interrupted');
        await expect(coordinator.answerDelivered()).resolves.toBeNull();
        expect(executor.execute).not.toHaveBeenCalled();
    });

    it('does not lose a delivered-answer signal while a superseded demo is winding down', async () => {
        let finishFirst;
        const executor = {
            execute: vi.fn()
                .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
                .mockResolvedValueOnce({ status: 'completed' }),
            cancel: vi.fn()
        };
        const coordinator = createAnswerFirstDemoCoordinator({ executor });
        coordinator.schedule({ id: 'first' }, { routeRevision: 1 });
        const first = coordinator.answerDelivered();
        coordinator.schedule({ id: 'second' }, { routeRevision: 2 });
        await coordinator.answerDelivered();
        finishFirst({ status: 'cancelled' });
        await first;

        expect(executor.execute).toHaveBeenNthCalledWith(
            2, { id: 'second' }, { routeRevision: 2 }
        );
    });
});
