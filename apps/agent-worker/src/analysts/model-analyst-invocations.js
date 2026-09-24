const MEMORY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        knownFacts: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
        interests: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
        objections: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
        askedQuestions: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
        declinedTopics: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }
    },
    required: [
        'confidence', 'knownFacts', 'interests', 'objections',
        'askedQuestions', 'declinedTopics'
    ]
};

const FOLLOW_UP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        category: { type: 'string', minLength: 1, maxLength: 120 },
        department: { type: ['string', 'null'], maxLength: 120 },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] }
    },
    required: ['confidence', 'category', 'department', 'priority']
};

function parseJsonResult(result, label, maxChars = 12000) {
    const text = typeof result === 'string' ? result : result?.text;
    if (typeof text !== 'string' || text.length > maxChars) {
        throw new TypeError(`invalid ${label} model response`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new TypeError(`invalid ${label} model response`);
    }
}

function modelInput(route, system, payload, schemaName, schema) {
    return {
        model: route?.model,
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        responseFormat: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema }
        }
    };
}

export function createParticipantMemoryModelInvocation({ complete }) {
    if (typeof complete !== 'function') throw new TypeError('model completion is required');
    return async ({ modelRoute, transcript, participantMemory, sharedMemory, signal }) => {
        if (signal?.aborted) return null;
        const result = await complete(modelInput(
            modelRoute,
            'Extract only durable, useful conversation memory explicitly supported by the latest utterance. Keep questions, interests, objections and declined topics distinct. Do not extract names, email addresses, phone numbers, companies, secrets or other contact PII. Do not repeat values already present. Return empty arrays when nothing durable changed.',
            { transcript, participantMemory, sharedMemory },
            'participant_memory_analysis',
            MEMORY_SCHEMA
        ));
        if (signal?.aborted) return null;
        return parseJsonResult(result, 'participant memory');
    };
}

export function createFollowUpClassificationModelInvocation({ complete }) {
    if (typeof complete !== 'function') throw new TypeError('model completion is required');
    return async ({ modelRoute, question, signal }) => {
        if (signal?.aborted) return null;
        const result = await complete(modelInput(
            modelRoute,
            'Classify a consented customer follow-up question for internal routing. Do not answer it and do not invent customer facts. Use a short stable category and an optional business department.',
            { question },
            'follow_up_classification',
            FOLLOW_UP_SCHEMA
        ));
        if (signal?.aborted) return null;
        return parseJsonResult(result, 'follow-up classification');
    };
}
