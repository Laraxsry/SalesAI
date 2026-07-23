import { describe, it, expect } from 'vitest';
import { startAvatarWithFallback } from './index.js';

/**
 * Chaos test (Phase 7, Task 6 — "kill a provider/dependency mid-session and
 * assert fallback"), scoped to avatar since it's the one capability whose
 * fallback (`voice-only`) never makes a real network call and costs nothing
 * to exercise for real: no mocking of our own code, just a real primary
 * provider failure (Tavus's LiveKit plugin genuinely rejecting a fake
 * room/agentSession) and a real fallback attach.
 */
describe('startAvatarWithFallback (chaos: primary provider fails)', () => {
    it('falls back to voice-only when the primary avatar provider fails to attach', async () => {
        const fakeRoom = {};
        const fakeAgentSession = {};

        const { provider, attached } = await startAvatarWithFallback({
            name: 'tavus',
            agentSession: fakeAgentSession,
            room: fakeRoom
        });

        expect(provider.id).toBe('voice-only');
        expect(attached).toEqual({ attached: false });
    });
});
