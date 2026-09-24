import { describe, expect, it, vi } from 'vitest';
import {
    buildPresenceCheckInstructions, createConversationIdlePolicy
} from './conversation-idle-policy.js';
import { createSilenceDriver } from './silence-driver.js';

describe('conversation idle policy', () => {
    it('keeps a single check-in in the configured language', () => {
        expect(buildPresenceCheckInstructions('Turkish')).toContain('Hâlâ benimle misiniz');
        expect(buildPresenceCheckInstructions('English')).not.toContain('Hâlâ benimle misiniz');
    });
    it('advances a narrated presentation when there is no question', () => {
        const policy = createConversationIdlePolicy();
        expect(policy.decide({ presentationActive: true })).toBe('advance_presentation');
        expect(policy.decide({ presentationActive: true })).toBe('advance_presentation');
    });

    it('checks in once after a real question, then waits without advancing', () => {
        const policy = createConversationIdlePolicy();
        policy.onQuestionAsked();
        expect(policy.decide({ presentationActive: true })).toBe('check_in');
        expect(policy.decide({ presentationActive: true })).toBe('wait');
        expect(policy.awaitingAnswer).toBe(true);
    });

    it('checks in once after the playbook, then stops until a visitor turn', () => {
        const policy = createConversationIdlePolicy();
        expect(policy.decide()).toBe('check_in');
        expect(policy.decide()).toBe('wait');
        policy.onVisitorTurn();
        expect(policy.decide()).toBe('check_in');
    });

    it('treats a free-form spoken question as awaiting an answer', () => {
        const policy = createConversationIdlePolicy();
        expect(policy.onAssistantUtterance('Hangi sektörde çalışıyorsunuz?')).toBe(true);
        expect(policy.decide()).toBe('check_in');
        expect(policy.decide()).toBe('wait');
    });

    it('regresses the silent session: presentation advances, then only one check-in', () => {
        vi.useFakeTimers();
        try {
            const policy = createConversationIdlePolicy();
            let presentationActive = true;
            const actions = [];
            const driver = createSilenceDriver({
                idleMs: 10,
                maxConsecutive: 20,
                onIdle: () => actions.push(policy.decide({ presentationActive }))
            });
            driver.handleAgentState('listening');
            vi.advanceTimersByTime(10);
            expect(actions).toEqual(['advance_presentation']);

            presentationActive = false;
            driver.handleAgentState('speaking');
            driver.handleAgentState('listening');
            vi.advanceTimersByTime(10);
            expect(actions).toEqual(['advance_presentation', 'check_in']);

            // The check-in itself completes; another quiet window cannot
            // manufacture the repeated unanswered discovery questions seen
            // in the real session.
            driver.handleAgentState('speaking');
            driver.handleAgentState('listening');
            vi.advanceTimersByTime(10);
            expect(actions).toEqual(['advance_presentation', 'check_in', 'wait']);
            driver.dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});
