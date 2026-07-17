import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

let socket;

/** Lazily-created shared Socket.IO connection to the API's realtime server. */
export function getSocket() {
    if (!socket) {
        socket = io(API_URL, { transports: ['websocket'] });
    }
    return socket;
}
