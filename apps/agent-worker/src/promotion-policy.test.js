import { describe, expect, it } from 'vitest';
import { evaluatePromotion } from './promotion-policy.js';

const identity = {
    topicId: 'topic:reporting',
    claimIds: ['claim:reporting:auto'],
    source: 'semantic_resolver'
};

function memory(overrides = {}) {
    return {
        turnIndex: 10,
        coveredClaims: [],
        knownFacts: [],
        unresolvedConcerns: [],
        declinedTopics: [],
        ...overrides
    };
}

describe('promotion policy', () => {
    it('allows direct customer questions even after proactive budget is exhausted', () => {
        const result = evaluatePromotion({
            memory: memory({
                coveredClaims: [{
                    topicId: identity.topicId,
                    proactiveMentionCount: 3,
                    proactiveDemoCount: 2,
                    lastTurnIndex: 9
                }]
            }),
            semanticIdentity: identity,
            deliveryIntent: 'direct_answer',
            target: 'demo'
        });
        expect(result).toMatchObject({ allowed: true, reason: 'customer_requested' });
    });

    it('blocks repeated proactive promotion during cooldown', () => {
        const result = evaluatePromotion({
            memory: memory({
                coveredClaims: [{
                    topicId: identity.topicId,
                    proactiveMentionCount: 1,
                    proactiveDemoCount: 1,
                    lastTurnIndex: 8
                }]
            }),
            semanticIdentity: identity,
            deliveryIntent: 'proactive_promotion'
        });
        expect(result).toEqual({ allowed: false, reason: 'promotion_cooldown' });
    });

    it('blocks declined topics but allows an interrupted delivery to resume', () => {
        expect(evaluatePromotion({
            memory: memory({ declinedTopics: [identity.topicId] }),
            semanticIdentity: identity,
            deliveryIntent: 'proactive_promotion'
        })).toEqual({ allowed: false, reason: 'topic_declined' });

        expect(evaluatePromotion({
            memory: memory(),
            semanticIdentity: identity,
            deliveryIntent: 'proactive_promotion',
            interrupted: true
        })).toEqual({ allowed: true, reason: 'previous_delivery_interrupted' });
    });

    it('requires semantic identity for proactive claims', () => {
        expect(evaluatePromotion({
            memory: memory(), semanticIdentity: null,
            deliveryIntent: 'proactive_promotion'
        })).toEqual({ allowed: false, reason: 'missing_semantic_identity' });
    });
});
