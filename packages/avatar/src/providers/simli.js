import { voice, getJobContext } from '@livekit/agents';
import { TrackKind } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const ATTRIBUTE_PUBLISH_ON_BEHALF = 'lk.publish_on_behalf';
const SAMPLE_RATE = 16000;
const AVATAR_AGENT_IDENTITY = 'simli-avatar-agent';
const AVATAR_AGENT_NAME = 'simli-avatar-agent';
const DEFAULT_API_URL = 'https://api.simli.ai';
// Simli's documented default Trinity emotion ("happy_0") — see https://docs.simli.com/emotions
const DEFAULT_EMOTION_ID = '92f24a0c-f046-45df-8df0-af7449c04571';

export class SimliException extends Error {
    constructor(message) {
        super(message);
        this.name = 'SimliException';
    }
}

/**
 * Real-time Simli avatar, joined server-side into the LiveKit room — same
 * shape as `TavusAvatar` (extends `voice.AvatarSession`, forwards TTS audio
 * over a LiveKit data stream, waits for Simli's own participant to publish
 * video). No official `@livekit/agents-plugin-simli` package exists yet, so
 * this ports the exact two-call handshake from the Python
 * `livekit-plugins-simli` package (https://docs.simli.com/api-reference/livekit,
 * source: livekit/agents `livekit-plugins-simli/livekit/plugins/simli/avatar.py`):
 *
 *   1. POST {apiUrl}/compose/token           (x-simli-api-key header) -> { session_token }
 *   2. POST {apiUrl}/integrations/livekit/agents
 *      { session_token, livekit_token, livekit_url }
 *
 * Simli's service then joins `room` as a participant and publishes real
 * audio+video; the visitor app renders it exactly like Tavus's — via the
 * generic `useVoiceAssistant()` video track — no client-specific code needed.
 *
 * Previously this provider was a client-driven no-op (`attached: false`)
 * that depended on a `simli-client` browser integration that was never
 * built. This replaces that with the working server-side path instead.
 */
export class SimliAvatar extends voice.AvatarSession {
    get avatarIdentity() {
        return AVATAR_AGENT_IDENTITY;
    }

    get provider() {
        return 'simli';
    }

    get id() {
        return 'simli';
    }

    async start({ agentSession, room }) {
        await super.start(agentSession, room);

        const apiKey = process.env.SIMLI_API_KEY;
        const faceId = process.env.SIMLI_FACE_ID;
        if (!apiKey) throw new SimliException('[avatar:simli] SIMLI_API_KEY must be set');
        if (!faceId) throw new SimliException('[avatar:simli] SIMLI_FACE_ID must be set');

        const livekitUrl = process.env.LIVEKIT_URL;
        const livekitApiKey = process.env.LIVEKIT_API_KEY;
        const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
        if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
            throw new SimliException(
                '[avatar:simli] LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set'
            );
        }

        const localParticipantIdentity = this.#resolveLocalIdentity(room);
        if (!localParticipantIdentity) {
            throw new SimliException('[avatar:simli] failed to get local participant identity');
        }

        const at = new AccessToken(livekitApiKey, livekitApiSecret, {
            identity: AVATAR_AGENT_IDENTITY,
            name: AVATAR_AGENT_NAME
        });
        at.kind = 'agent';
        at.addGrant({ roomJoin: true, room: room.name });
        // Lets Simli's avatar participant publish audio/video "on behalf of" our
        // own agent identity, so the visitor sees one coherent speaker.
        at.attributes = { [ATTRIBUTE_PUBLISH_ON_BEHALF]: localParticipantIdentity };
        const livekitToken = await at.toJwt();

        const apiUrl = process.env.SIMLI_API_URL || DEFAULT_API_URL;
        const emotionId = process.env.SIMLI_EMOTION_ID || DEFAULT_EMOTION_ID;

        const sessionToken = await this.#composeToken({ apiUrl, apiKey, faceId, emotionId });
        await this.#joinLiveKitRoom({ apiUrl, sessionToken, livekitToken, livekitUrl });

        agentSession.output.audio = new voice.DataStreamAudioOutput({
            room,
            destinationIdentity: AVATAR_AGENT_IDENTITY,
            sampleRate: SAMPLE_RATE,
            waitRemoteTrack: TrackKind.KIND_VIDEO
        });

        return { attached: true };
    }

    /** Mirrors the identity-resolution fallback chain the Tavus plugin uses. */
    #resolveLocalIdentity(room) {
        try {
            const jobCtx = getJobContext();
            return jobCtx.agent?.identity || room.localParticipant?.identity;
        } catch {
            return room.localParticipant?.identity;
        }
    }

    async #composeToken({ apiUrl, apiKey, faceId, emotionId }) {
        const res = await fetch(`${apiUrl}/compose/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-simli-api-key': apiKey },
            body: JSON.stringify({
                faceId: `${faceId}/${emotionId}`,
                handleSilence: true,
                maxSessionLength: 600,
                maxIdleTime: 30
            })
        });
        if (!res.ok) {
            throw new SimliException(`[avatar:simli] /compose/token failed: ${res.status} ${await res.text()}`);
        }
        const { session_token: sessionToken } = await res.json();
        return sessionToken;
    }

    async #joinLiveKitRoom({ apiUrl, sessionToken, livekitToken, livekitUrl }) {
        const res = await fetch(`${apiUrl}/integrations/livekit/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: sessionToken, livekit_token: livekitToken, livekit_url: livekitUrl })
        });
        if (!res.ok) {
            throw new SimliException(
                `[avatar:simli] /integrations/livekit/agents failed: ${res.status} ${await res.text()}`
            );
        }
    }

    getClientConfig() {
        return { type: 'simli', render: 'video-track' };
    }
}
