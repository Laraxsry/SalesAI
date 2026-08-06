import { describe, expect, it } from 'vitest';
import { isValidEmbedSession, resolveEmbedParentOrigin } from './embedProtocol.js';

describe('embed protocol', () => {
    it('accepts a complete session payload', () => {
        expect(isValidEmbedSession({
            sessionId: 'session-1',
            roomName: 'room-1',
            token: 'jwt',
            livekitUrl: 'wss://livekit.example.com',
        })).toBe(true);
    });

    it('rejects incomplete session credentials', () => {
        expect(isValidEmbedSession({ roomName: 'room-1', token: 'jwt' })).toBe(false);
    });

    it('uses the declared SDK parent origin when referrer is unavailable', () => {
        const params = new URLSearchParams('embed=1&parentOrigin=https%3A%2F%2Fshop.example.com');
        expect(resolveEmbedParentOrigin(params)).toBe('https://shop.example.com');
    });

    it('rejects a declared origin that conflicts with the browser referrer', () => {
        const params = new URLSearchParams('embed=1&parentOrigin=https%3A%2F%2Fevil.example.com');
        expect(resolveEmbedParentOrigin(params, 'https://shop.example.com/product/1')).toBeNull();
    });
});
