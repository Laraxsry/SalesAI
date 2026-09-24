import { describe, expect, it, vi } from 'vitest';
import {
    createFollowUpClassificationModelInvocation,
    createParticipantMemoryModelInvocation
} from './model-analyst-invocations.js';

describe('model analyst invocations', () => {
    it('requests strict PII-free participant memory JSON', async () => {
        const complete = vi.fn().mockResolvedValue({ text: JSON.stringify({
            confidence: 0.9,
            knownFacts: [], interests: ['güvenlik'], objections: [],
            askedQuestions: [], declinedTopics: []
        }) });
        const invoke = createParticipantMemoryModelInvocation({ complete });
        await expect(invoke({
            modelRoute: { model: 'mini' }, transcript: 'Güvenlik önemli',
            participantMemory: null, sharedMemory: {}, signal: new AbortController().signal
        })).resolves.toMatchObject({ interests: ['güvenlik'] });
        expect(complete.mock.calls[0][0].responseFormat.json_schema.strict).toBe(true);
        expect(complete.mock.calls[0][0].system).toContain('Do not extract names');
    });

    it('classifies follow-up routing without granting side effects', async () => {
        const invoke = createFollowUpClassificationModelInvocation({
            complete: async () => ({ text: JSON.stringify({
                confidence: 0.8, category: 'security', department: 'engineering', priority: 'high'
            }) })
        });
        await expect(invoke({ question: 'SSO var mı?' })).resolves.toEqual({
            confidence: 0.8, category: 'security', department: 'engineering', priority: 'high'
        });
    });
});
