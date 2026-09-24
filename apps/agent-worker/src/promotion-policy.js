export const DEFAULT_PROMOTION_POLICY = Object.freeze({
    maxProactiveMentionsPerTopic: 1,
    maxProactiveDemosPerTopic: 1,
    cooldownTurns: 6
});

function topicCoverage(memory, topicId) {
    return memory.coveredClaims.filter((record) => record.topicId === topicId);
}

/** Deterministic advisory policy; it never mutates memory or route state. */
export function evaluatePromotion({
    memory,
    semanticIdentity,
    deliveryIntent,
    target = 'mention',
    interrupted = false,
    currentlyRelevant = true
}, policy = DEFAULT_PROMOTION_POLICY) {
    if (!semanticIdentity) {
        return deliveryIntent === 'proactive_promotion'
            ? { allowed: false, reason: 'missing_semantic_identity' }
            : { allowed: true, reason: 'customer_requested_without_identity' };
    }
    const topicId = semanticIdentity.topicId;
    if (deliveryIntent !== 'proactive_promotion') {
        return {
            allowed: true,
            reason: 'customer_requested',
            instruction: 'Answer directly without reopening the broader sales pitch.'
        };
    }
    if (!currentlyRelevant) return { allowed: false, reason: 'not_currently_relevant' };
    if (memory.declinedTopics.includes(topicId)) {
        return { allowed: false, reason: 'topic_declined' };
    }
    if (interrupted) return { allowed: true, reason: 'previous_delivery_interrupted' };

    const records = topicCoverage(memory, topicId);
    const mentions = Math.max(0, ...records.map((record) => record.proactiveMentionCount));
    const demos = Math.max(0, ...records.map((record) => record.proactiveDemoCount));
    const lastTurn = Math.max(0, ...records.map((record) => record.lastTurnIndex));
    if (memory.turnIndex - lastTurn < policy.cooldownTurns && records.length > 0) {
        return { allowed: false, reason: 'promotion_cooldown' };
    }
    if (target === 'demo' && demos >= policy.maxProactiveDemosPerTopic) {
        return { allowed: false, reason: 'demo_budget_exhausted' };
    }
    if (mentions >= policy.maxProactiveMentionsPerTopic) {
        return { allowed: false, reason: 'mention_budget_exhausted' };
    }
    return { allowed: true, reason: 'within_promotion_budget' };
}
