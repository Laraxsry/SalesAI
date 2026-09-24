import { describe, expect, it } from 'vitest';
import { ConversationMemoryInput } from '@repo/contracts';
import { createKnownFactResolver } from './known-fact-resolver.js';

function memory(input = {}) {
    return ConversationMemoryInput.parse(input);
}

function fact(value, source = 'survey', confidence = 0.95) {
    return {
        key: 'company.industry', value, source, confidence,
        capturedTurnIndex: 2, evidenceRef: `${source}:industry`
    };
}

describe('known fact resolver', () => {
    it('returns a high-confidence in-session fact without asking again', async () => {
        const result = await createKnownFactResolver().resolve({
            key: 'company.industry',
            memory: memory({ discoveredFacts: { 'company.industry': fact('saas') } })
        });
        expect(result).toMatchObject({
            status: 'known', reason: 'high_confidence_fact', fact: { value: 'saas' }
        });
    });

    it('treats a previous dismiss or expiry as a terminal session answer', async () => {
        const result = await createKnownFactResolver().resolve({
            key: 'company.industry',
            memory: memory({
                askedQuestions: {
                    'company.industry': {
                        questionKey: 'company.industry', channel: 'survey',
                        status: 'dismissed', askedTurnIndex: 3, answerRef: null
                    }
                }
            })
        });
        expect(result.status).toBe('declined');
    });

    it('surfaces credible conflicts instead of choosing a convenient value', async () => {
        const resolver = createKnownFactResolver({
            providers: [{
                id: 'crm', priority: 500,
                lookup: async () => fact('finance', 'crm', 0.9)
            }]
        });
        const result = await resolver.resolve({
            key: 'company.industry',
            memory: memory({ discoveredFacts: { 'company.industry': fact('saas') } })
        });
        expect(result).toMatchObject({ status: 'conflict', reason: 'conflicting_fact_sources' });
        expect(result.candidates).toHaveLength(2);
    });

    it('does not turn an unavailable higher-priority source into unknown', async () => {
        const resolver = createKnownFactResolver({
            providers: [{
                id: 'crm', priority: 500,
                lookup: async () => { throw new Error('CRM offline'); }
            }]
        });
        const result = await resolver.resolve({
            key: 'company.industry',
            memory: memory({ discoveredFacts: { 'company.industry': fact('saas') } })
        });
        expect(result).toMatchObject({
            status: 'verify', reason: 'higher_priority_source_unavailable'
        });
    });
});
