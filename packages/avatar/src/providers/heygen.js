/**
 * HeyGen LiveAvatar (Interactive Avatar API, LiveKit-backed). The agent's text
 * stream drives the avatar; HeyGen publishes the 720p video into the room.
 * Session creation is done via HeyGen's REST API.
 */
export class HeyGenAvatar {
    get id() {
        return 'heygen';
    }

    // eslint-disable-next-line no-unused-vars
    async start({ agentSession, room }) {
        // Integration point: create a HeyGen interactive session bound to `room`.
        // Implemented in agent-worker where the agent text stream is available.
        return { attached: true, external: true };
    }

    getClientConfig() {
        return { type: 'heygen', render: 'video-track', avatarId: process.env.HEYGEN_AVATAR_ID };
    }
}
