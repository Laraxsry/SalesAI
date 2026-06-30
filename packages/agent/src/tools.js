import { retrieve } from '@repo/rag';

/**
 * Builds the tool set exposed to the LLM for a given session. The handlers are
 * wired by the agent-worker (it owns the GuidedTour + screen track). Here we
 * define the schema + the knowledge tool that only needs productId.
 *
 * @param {{ productId:string, tour?:object, screen?:object }} ctx
 */
export function buildTools({ productId, tour, screen }) {
    return [
        {
            name: 'search_knowledge',
            description: 'Search the product knowledge base for facts to answer a question.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    topK: { type: 'number' }
                },
                required: ['query']
            },
            handler: async ({ query, topK = 8 }) => {
                const chunks = await retrieve({ productId, query, topK });
                return chunks.map((c) => ({ text: c.text, score: c.score, sourceId: c.sourceId }));
            }
        },
        {
            name: 'start_guided_tour',
            description: 'Open the live product dashboard to visually demonstrate it.',
            parameters: {
                type: 'object',
                properties: { url: { type: 'string' } }
            },
            handler: async ({ url }) => tour?.openAt?.(url) ?? { ok: false }
        },
        {
            name: 'navigate_to',
            description: 'Navigate the shown dashboard to a specific page/URL.',
            parameters: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url']
            },
            handler: async ({ url }) => tour?.goto?.(url) ?? { ok: false }
        },
        {
            name: 'highlight',
            description: 'Highlight an element on the shown dashboard so the customer can follow.',
            parameters: {
                type: 'object',
                properties: { selector: { type: 'string' } },
                required: ['selector']
            },
            handler: async ({ selector }) => tour?.highlight?.(selector) ?? { ok: false }
        },
        {
            name: 'read_customer_screen',
            description: "Look at the customer's shared screen to guide their next action.",
            parameters: {
                type: 'object',
                properties: { question: { type: 'string' } }
            },
            handler: async ({ question }) => screen?.read?.(question) ?? { ok: false }
        }
    ];
}
