import { describe, expect, it, vi } from 'vitest';
import { createCustomerReplanTrigger, shouldReplanForUtterance } from './customer-replan-trigger.js';

describe('customer reconsideration', () => {
    it('ignores acknowledgements and recognizes explicit questions or requests', () => {
        expect(shouldReplanForUtterance('Evet.')).toBe(false);
        expect(shouldReplanForUtterance('Anladım')).toBe(false);
        expect(shouldReplanForUtterance('PDF ekstreyi nasıl yüklüyorum')).toBe(true);
        expect(shouldReplanForUtterance('Bana rapor ekranını göster')).toBe(true);
    });

    it('drops a stale retrieval after a newer utterance', async () => {
        let finish;
        const onResolution = vi.fn();
        const trigger = createCustomerReplanTrigger({
            resolve: () => new Promise((resolve) => { finish = resolve; }),
            onResolution
        });
        const pending = trigger.onUtterance('Nasıl yüklerim?', 'product');
        await Promise.resolve();
        await trigger.onUtterance('Tamam', 'product');
        finish({ intentId: 'old' });
        expect(await pending).toBe(false);
        expect(onResolution).not.toHaveBeenCalled();
    });

    it('handles the same intent only once across transcript and tool resolution', async () => {
        const resolution = { intentId: 'same' };
        const onResolution = vi.fn();
        const trigger = createCustomerReplanTrigger({
            resolve: async () => resolution,
            onResolution
        });
        expect(await trigger.onUtterance('Nasıl yüklerim?', 'product')).toBe(true);
        expect(await trigger.onToolResolution(resolution)).toBe(false);
        expect(onResolution).toHaveBeenCalledTimes(1);
    });
});
