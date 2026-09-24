import { describe, expect, it } from 'vitest';
import { resolveTrustedParticipantContext } from './participant-attribution.js';
import { createParticipantRegistry } from './participant-registry.js';

function idFactory() {
    let value = 0;
    return () => `participant-${++value}`;
}

describe('participant registry', () => {
    it('keeps participantId stable when LiveKit identity changes on reconnect', () => {
        const registry = createParticipantRegistry({
            sessionId: 'session-1',
            createParticipantId: idFactory()
        });
        const first = registry.upsert({
            identity: 'visitor_old', visitorKey: 'device-1', name: 'Ali'
        });
        const returning = registry.upsert({
            identity: 'visitor_new', visitorKey: 'device-1', name: 'Ali'
        });

        expect(returning.participantId).toBe(first.participantId);
        expect(registry.getByIdentity('visitor_old')).toBeNull();
        expect(registry.getByIdentity('visitor_new')).toMatchObject({
            participantId: first.participantId,
            visitorKey: 'device-1'
        });
    });

    it('does not merge different people merely because they share a name', () => {
        const registry = createParticipantRegistry({
            sessionId: 'session-1',
            createParticipantId: idFactory()
        });
        const first = registry.upsert({ identity: 'visitor_1', visitorKey: 'key-1', name: 'Deniz' });
        const second = registry.upsert({ identity: 'visitor_2', visitorKey: 'key-2', name: 'Deniz' });

        expect(first.participantId).not.toBe(second.participantId);
        expect(registry.list()).toHaveLength(2);
    });

    it('never uses a matching name to merge two simultaneously connected people', () => {
        const registry = createParticipantRegistry({
            sessionId: 'session-1',
            createParticipantId: idFactory()
        });
        const first = registry.upsert({ identity: 'visitor_1', name: 'Deniz' });
        const second = registry.upsert({ identity: 'visitor_2', name: 'Deniz' });

        expect(first.participantId).not.toBe(second.participantId);
        expect(registry.list()).toHaveLength(2);
    });

    it('allows exact-name reconnect only after a keyless participant disconnected', () => {
        const registry = createParticipantRegistry({
            sessionId: 'session-1',
            createParticipantId: idFactory()
        });
        const first = registry.upsert({ identity: 'visitor_old', name: 'Deniz' });
        registry.markDisconnected('visitor_old');
        const returning = registry.upsert({ identity: 'visitor_new', name: 'Deniz' });

        expect(returning.participantId).toBe(first.participantId);
        expect(returning.connected).toBe(true);
    });
});

describe('trusted participant attribution', () => {
    it('prefers the event speaker and exposes the server-owned participantId', () => {
        const registry = createParticipantRegistry({
            sessionId: 'session-1', createParticipantId: idFactory()
        });
        const ali = registry.upsert({ identity: 'visitor_ali', visitorKey: 'key-1', name: 'Ali' });
        registry.upsert({ identity: 'visitor_ayse', visitorKey: 'key-2', name: 'Ayşe' });

        const context = resolveTrustedParticipantContext({
            registry,
            eventSpeakerId: 'visitor_ali',
            fallbackIdentity: 'visitor_ayse',
            micOnFor: () => true
        });

        expect(context).toMatchObject({
            participantId: ali.participantId,
            livekitIdentity: 'visitor_ali',
            attribution: 'event_speaker'
        });
    });

    it('does not guess when neither an event speaker nor a live fallback exists', () => {
        const registry = createParticipantRegistry({
            sessionId: 'session-1', createParticipantId: idFactory()
        });
        registry.upsert({ identity: 'visitor_ali', visitorKey: 'key-1', name: 'Ali' });

        const context = resolveTrustedParticipantContext({
            registry,
            eventSpeakerId: null,
            fallbackIdentity: 'visitor_ali',
            micOnFor: () => false
        });

        expect(context).toMatchObject({ participantId: null, attribution: 'unattributed' });
    });
});
