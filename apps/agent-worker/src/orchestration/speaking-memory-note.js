function lines(label, values, limit = 8) {
    const bounded = Array.isArray(values) ? values.slice(-limit) : [];
    return bounded.length ? `${label}: ${bounded.join(' | ')}` : null;
}

/** Converts accepted, PII-free memory into a small instruction suffix. */
export function buildSpeakingMemoryNote(projection, { displayName = null } = {}) {
    if (!projection?.activeParticipant) return '';
    const participant = projection.activeParticipant;
    const content = [
        displayName ? `Active participant: ${displayName}` : 'Active participant is attributed.',
        lines('Known context', participant.knownFacts),
        lines('Interests', participant.interests),
        lines('Objections', participant.objections),
        lines('Questions already asked', participant.askedQuestions),
        lines('Topics they declined', participant.declinedTopics),
        lines('Shared topics already covered', projection.shared?.coveredTopics, 12),
        lines('Still-open shared questions', projection.shared?.openQuestions, 12)
    ].filter(Boolean);
    return [
        'INTERNAL ACCEPTED CONVERSATION MEMORY (never quote this heading):',
        ...content,
        'Use this only to avoid repetition and keep continuity. Answer a repeated customer question normally, but do not repeatedly promote the same point. Never attribute one participant\'s memory to another.'
    ].join('\n');
}
