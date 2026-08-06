import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initializeLogger } from '@livekit/agents';
import { SimliAvatar, SimliException } from './simli.js';

// `voice.AvatarSession` (the base class) reaches into @livekit/agents' own
// logger on construction; in the real agent-worker this is already set up by
// `cli.runApp()` before any job runs. Tests need the same one-time setup.
beforeAll(() => {
    initializeLogger({ pretty: false, level: 'silent' });
});

/** Minimal stand-ins for the LiveKit `AgentSession`/`Room` objects `start()` touches. */
function fakeAgentSession() {
    return { output: { audio: null }, _started: false, on: () => {} };
}
function fakeRoom() {
    return { isConnected: false, on: () => {}, name: 'test-room', localParticipant: { identity: 'agent-x' } };
}

const ENV_KEYS = ['SIMLI_API_KEY', 'SIMLI_FACE_ID', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
const savedEnv = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
});
afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
});

describe('SimliAvatar', () => {
    it('fails fast with SimliException when SIMLI_API_KEY is missing', async () => {
        process.env.SIMLI_FACE_ID = 'face-1';
        process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
        process.env.LIVEKIT_API_KEY = 'k';
        process.env.LIVEKIT_API_SECRET = 's';

        await expect(new SimliAvatar().start({ agentSession: fakeAgentSession(), room: fakeRoom() })).rejects.toThrow(
            SimliException
        );
    });

    it('fails fast with SimliException when SIMLI_FACE_ID is missing', async () => {
        process.env.SIMLI_API_KEY = 'key-1';
        process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
        process.env.LIVEKIT_API_KEY = 'k';
        process.env.LIVEKIT_API_SECRET = 's';

        await expect(new SimliAvatar().start({ agentSession: fakeAgentSession(), room: fakeRoom() })).rejects.toThrow(
            /SIMLI_FACE_ID/
        );
    });

    it('fails fast with SimliException when LiveKit server credentials are missing', async () => {
        process.env.SIMLI_API_KEY = 'key-1';
        process.env.SIMLI_FACE_ID = 'face-1';
        // LIVEKIT_URL/API_KEY/API_SECRET intentionally left unset.

        await expect(new SimliAvatar().start({ agentSession: fakeAgentSession(), room: fakeRoom() })).rejects.toThrow(
            /LIVEKIT_URL/
        );
    });

    it('exposes video-track render config for the (currently unused) client config contract', () => {
        expect(new SimliAvatar().getClientConfig()).toEqual({ type: 'simli', render: 'video-track' });
    });
});
