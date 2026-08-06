import { describe, expect, it } from 'vitest';
import { getNotificationRoute } from './notificationRoute';

describe('getNotificationRoute', () => {
    it('maps typed notification data to app routes', () => {
        expect(getNotificationRoute({ shareToken: 'share token' })).toBe('/v/share%20token');
        expect(getNotificationRoute({ sessionId: 'abc123' })).toBe('/saved/abc123');
    });

    it('accepts allowlisted universal and custom links', () => {
        expect(getNotificationRoute({ url: 'https://app.salesai.com/saved/abc123' })).toBe('/saved/abc123');
        expect(getNotificationRoute({ url: 'salesai://v/share123' })).toBe('/v/share123');
    });

    it('rejects external or unknown destinations', () => {
        expect(getNotificationRoute({ route: 'https://evil.example.com/account' })).toBeNull();
        expect(getNotificationRoute({ route: '/admin' })).toBeNull();
    });
});
