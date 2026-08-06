import { describe, expect, it } from 'vitest';
import { getLogger, requestContext, runWithContext } from './index.js';

describe('request logger context', () => {
    it('keeps request bindings across asynchronous work', async () => {
        await runWithContext({ requestId: 'req-123', tenantId: 'tenant-1' }, async () => {
            await Promise.resolve();

            expect(requestContext.getStore()).toEqual({
                requestId: 'req-123',
                tenantId: 'tenant-1'
            });
            expect(getLogger({ component: 'api' }).bindings()).toMatchObject({
                requestId: 'req-123',
                tenantId: 'tenant-1',
                component: 'api'
            });
        });

        expect(requestContext.getStore()).toBeUndefined();
    });

    it('lets explicit bindings override context defaults', () => {
        runWithContext({ requestId: 'context-id' }, () => {
            expect(getLogger({ requestId: 'explicit-id' }).bindings()).toMatchObject({
                requestId: 'explicit-id'
            });
        });
    });
});
