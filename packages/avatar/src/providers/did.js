/**
 * D-ID streaming avatar. Good for presenter-style talking heads from a photo.
 * Driven via D-ID's streaming API; video is bridged into the LiveKit room.
 */
export class DidAvatar {
    get id() {
        return 'did';
    }

    // eslint-disable-next-line no-unused-vars
    async start({ agentSession, room }) {
        return { attached: true, external: true };
    }

    getClientConfig() {
        return { type: 'did', render: 'video-track' };
    }
}
