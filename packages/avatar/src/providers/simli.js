/**
 * Simli realtime avatar. Simli is driven primarily from the visitor frontend
 * via `simli-client` in LiveKit mode (sub-100ms audio-to-face). The agent
 * publishes audio; the client renders the Simli face track. The server side
 * just hands the client the face id + a session token endpoint.
 */
export class SimliAvatar {
    get id() {
        return 'simli';
    }

    // eslint-disable-next-line no-unused-vars
    async start({ agentSession, room }) {
        // Rendering happens client-side; nothing to attach server-side.
        return { attached: false, clientDriven: true };
    }

    getClientConfig() {
        return {
            type: 'simli',
            render: 'client-sdk',
            faceId: process.env.SIMLI_FACE_ID
        };
    }
}
