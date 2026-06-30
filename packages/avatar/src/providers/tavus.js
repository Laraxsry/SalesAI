/**
 * Tavus realtime avatar via the LiveKit Node plugin.
 * The plugin renders a photoreal talking head and routes the agent's audio
 * for lip-sync. Loaded lazily so the package installs without the plugin.
 */
export class TavusAvatar {
    get id() {
        return 'tavus';
    }

    async start({ agentSession, room }) {
        const tavus = await import('@livekit/agents-plugin-tavus').catch(() => null);
        if (!tavus) {
            throw new Error('[avatar:tavus] @livekit/agents-plugin-tavus is not installed');
        }
        const avatar = new tavus.AvatarSession({
            replicaId: process.env.TAVUS_REPLICA_ID,
            personaId: process.env.TAVUS_PERSONA_ID
        });
        await avatar.start(agentSession, room);
        return { attached: true };
    }

    getClientConfig() {
        return { type: 'tavus', render: 'video-track' };
    }
}
