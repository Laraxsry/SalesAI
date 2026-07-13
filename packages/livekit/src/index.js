import { AccessToken, RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';

const URL = () => process.env.LIVEKIT_URL || 'ws://localhost:7880';
const API_KEY = () => process.env.LIVEKIT_API_KEY || 'devkey';
const API_SECRET = () => process.env.LIVEKIT_API_SECRET || 'secret';

/**
 * Mints a LiveKit access token for a participant joining a room.
 * @param {{ roomName:string, identity:string, name?:string, metadata?:object }} input
 */
export async function createAccessToken({ roomName, identity, name, metadata }) {
    const at = new AccessToken(API_KEY(), API_SECRET(), {
        identity,
        name,
        metadata: metadata ? JSON.stringify(metadata) : undefined
    });
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    return at.toJwt();
}

/** REST client for server-side room management (create/list/delete). */
export function roomService() {
    const httpUrl = URL().replace('ws://', 'http://').replace('wss://', 'https://');
    return new RoomServiceClient(httpUrl, API_KEY(), API_SECRET());
}

/**
 * Explicitly dispatches a named agent-worker into a LiveKit room.
 * The agent-worker must be registered with `agentName` in its WorkerOptions.
 *
 * @param {{ roomName:string, agentName?:string, metadata?:object }} input
 */
export async function dispatchAgent({ roomName, agentName = 'salesai-agent', metadata } = {}) {
    const httpUrl = URL().replace('ws://', 'http://').replace('wss://', 'https://');
    const client = new AgentDispatchClient(httpUrl, API_KEY(), API_SECRET());
    return client.createDispatch(roomName, agentName, {
        metadata: metadata ? JSON.stringify(metadata) : undefined
    });
}

export const livekitUrl = URL;
