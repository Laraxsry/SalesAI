import { describe, expect, it } from 'vitest';
import { isEnabledFeatureFlag } from './feature-flags.js';

describe('isEnabledFeatureFlag', () => {
    it.each(['1', 'true', 'TRUE', ' yes ', 'on'])('enables explicit value %j', (value) => {
        expect(isEnabledFeatureFlag(value)).toBe(true);
    });

    it.each([undefined, null, '', '0', 'false', 'disabled', 'truthy'])('rejects value %j', (value) => {
        expect(isEnabledFeatureFlag(value)).toBe(false);
    });
});
