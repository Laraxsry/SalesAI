import { withFallback } from '@repo/resilience';
import { VoiceOnlyAvatar } from './providers/voice-only.js';
import { TavusAvatar } from './providers/tavus.js';
import { SimliAvatar } from './providers/simli.js';
import { HeyGenAvatar } from './providers/heygen.js';
import { DidAvatar } from './providers/did.js';

/**
 * Returns an avatar provider (strategy pattern). The developer chooses the
 * provider via the agent config / AVATAR_PROVIDER env var; it is NOT an
 * end-user choice.
 *
 * Every provider implements:
 *   async start({ agentSession, room }): attaches the talking face to the room.
 *   getClientConfig(): config the visitor frontend may need (e.g. Simli).
 *
 * @param {'voice-only'|'tavus'|'simli'|'heygen'|'did'} [name]
 */
export function getAvatarProvider(name = process.env.AVATAR_PROVIDER || 'voice-only') {
    switch (name) {
        case 'tavus':
            return new TavusAvatar();
        case 'simli':
            return new SimliAvatar();
        case 'heygen':
            return new HeyGenAvatar();
        case 'did':
            return new DidAvatar();
        case 'voice-only':
        default:
            return new VoiceOnlyAvatar();
    }
}

export const AVATAR_PROVIDERS = ['voice-only', 'tavus', 'simli', 'heygen', 'did'];

/**
 * Starts the configured avatar with automatic fallback to voice-only
 * (Phase 7 — generalizes the try/catch that used to live directly in
 * apps/agent-worker/src/agent.js).
 *
 * `voice-only` is always the last link in the chain and never fails (it has
 * nothing to attach — see providers/voice-only.js), so this call cannot
 * itself throw: the visitor always ends up in a working conversation, at
 * worst without a talking-face video.
 *
 * @param {{ name: string, agentSession: unknown, room: unknown }} params
 * @returns {Promise<{ provider: object, attached: object }>} the avatar
 *   strategy that actually started, and its start() return value.
 */
export async function startAvatarWithFallback({ name, agentSession, room }) {
    const chain = [...new Set([name, 'voice-only'])];
    let started;
    const attached = await withFallback({
        capability: 'avatar',
        providers: chain,
        invoke: async (providerName) => {
            started = getAvatarProvider(providerName);
            return started.start({ agentSession, room });
        }
    });
    return { provider: started, attached };
}
