import { describe, it, expect } from 'vitest';
import { classifyStartIntent, shouldStartMeeting, buildWaitingRoomPrompt } from './meeting.js';

describe('classifyStartIntent', () => {
    it('reads "start now" answers in Turkish and English', () => {
        for (const t of ['Başlayalım', 'evet başlayabiliriz', 'yes, go ahead', "let's go"]) {
            expect(classifyStartIntent(t)).toBe('start');
        }
    });

    it('reads "wait for more" answers', () => {
        for (const t of ['biraz daha bekleyelim', 'hayır, birkaç kişi daha katılacak', 'not yet']) {
            expect(classifyStartIntent(t)).toBe('wait');
        }
    });

    it('is unclear on anything off-topic or empty', () => {
        for (const t of ['', 'merhaba', 'fiyatları anlat']) {
            expect(classifyStartIntent(t)).toBe('unclear');
        }
    });
});

describe('shouldStartMeeting', () => {
    const base = { visitorCount: 2, maxParticipants: 5, waitedMs: 1_000, maxWaitMs: 600_000 };

    it('starts when the room is full', () => {
        expect(shouldStartMeeting({ ...base, visitorCount: 5 })).toBe(true);
    });

    it('starts when a visitor said go', () => {
        expect(shouldStartMeeting({ ...base, lastIntent: 'start' })).toBe(true);
    });

    it('starts once the safety wait is exhausted', () => {
        expect(shouldStartMeeting({ ...base, waitedMs: 600_000 })).toBe(true);
    });

    it('keeps waiting otherwise, and never starts with an empty room', () => {
        expect(shouldStartMeeting({ ...base, lastIntent: 'wait' })).toBe(false);
        expect(shouldStartMeeting({ ...base, visitorCount: 0, waitedMs: 9e9 })).toBe(false);
    });
});

describe('buildWaitingRoomPrompt', () => {
    it('names the counts and forbids tools, never leaks "playbook"', () => {
        const p = buildWaitingRoomPrompt({ visitorCount: 3, maxParticipants: 10 });
        expect(p).toContain('3');
        expect(p).toContain('10');
        expect(p.toLowerCase()).toContain('do not call any tools');
        expect(p.toLowerCase()).not.toContain('playbook');
    });
});
