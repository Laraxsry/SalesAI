import { describe, expect, it } from 'vitest';
import { canExecuteDynamicRoute } from './dynamic-route-authority.js';

const target = {
    enabled: true, cohort: 'canary', multiParticipant: false
};

describe('dynamic route execution authority', () => {
    it('uses the active session when globally enabled for a single-participant canary', () => {
        expect(canExecuteDynamicRoute(target)).toBe(true);
        for (const change of [
            { enabled: false }, { cohort: 'shadow' }, { multiParticipant: true }
        ]) {
            expect(canExecuteDynamicRoute({ ...target, ...change })).toBe(false);
        }
    });
});
