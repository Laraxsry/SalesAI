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
