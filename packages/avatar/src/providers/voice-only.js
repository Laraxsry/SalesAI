/**
 * No visual avatar. The agent publishes audio only; the visitor UI shows a
 * lightweight 2D animated orb/waveform driven by audio levels.
 */
export class VoiceOnlyAvatar {
    get id() {
        return 'voice-only';
    }

    // eslint-disable-next-line no-unused-vars
    async start({ agentSession, room }) {
        // Nothing to attach; audio flows straight from the agent session.
        return { attached: false };
    }

    getClientConfig() {
        return { type: 'voice-only', render: '2d-orb' };
    }
}
