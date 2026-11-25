import { describe, expect, it } from 'vitest';
import { isValidEmbedSession, parseEmbedLayout, resolveEmbedParentOrigin } from './embedProtocol.js';

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

    it('reads the SDK layout message', () => {
        expect(parseEmbedLayout({ type: 'salesai:embed:layout', expanded: true, canExpand: true })).toEqual({ expanded: true, canExpand: true });
    });

    it('treats a malformed layout message as compact and not expandable', () => {
        expect(parseEmbedLayout({ expanded: 'yes' })).toEqual({ expanded: false, canExpand: false });
        expect(parseEmbedLayout(undefined)).toEqual({ expanded: false, canExpand: false });
    });
});
