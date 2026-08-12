import { retrieve } from '@repo/rag';

/**
 * Builds the tool set exposed to the LLM for a given session. The handlers are
 * wired by the agent-worker (it owns the GuidedTour + screen track). Here we
 * define the schema + the knowledge tool that only needs productId.
 *
 * @param {{ productId:string, tour?:object, screen?:object, stopScreenShare?:Function, saveContactInfo?:Function }} ctx
 */
export function buildTools({ productId, tour, screen, stopScreenShare, saveContactInfo }) {
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
            name: 'click_element',
            description:
                'Click an element on the shown dashboard (buttons, nav links). Use a Playwright selector; prefer visible-text selectors like "text=Ücretler" for links and buttons.',
            parameters: {
                type: 'object',
                properties: { selector: { type: 'string' } },
                required: ['selector']
            },
            handler: async ({ selector }) => tour?.click?.(selector) ?? { ok: false }
        },
        {
            name: 'read_customer_screen',
            description: "Look at the customer's shared screen to guide their next action.",
            parameters: {
                type: 'object',
                properties: { question: { type: 'string' } }
            },
            handler: async ({ question }) => screen?.read?.(question) ?? { ok: false }
        },
        {
            name: 'stop_screen_share',
            description:
                'Stop showing the screen (closes an active guided tour demo, and/or asks the customer to stop sharing their own screen). Call this whenever the customer asks to close, hide, or stop the screen share.',
            parameters: { type: 'object', properties: {} },
            handler: async () => stopScreenShare?.() ?? { ok: false }
        },
        {
            name: 'read_tour_screen',
            description:
                "Look at the current guided-tour page you're driving (charts, numbers, table contents, anything not conveyed by clicking/highlighting) to answer a question about what's actually on screen right now.",
            parameters: {
                type: 'object',
                properties: { question: { type: 'string' } }
            },
            handler: async ({ question }) => tour?.readScreen?.(question) ?? { ok: false }
        },
        {
            name: 'save_contact_info',
            description:
                'Save a confirmed piece of contact info (name, email, or phone). Call this ONLY after reading the value back out loud to the visitor and receiving their explicit confirmation that it is correct — never before. Call once per field, right after it is confirmed.',
            parameters: {
                type: 'object',
                properties: {
                    field: { type: 'string', enum: ['name', 'email', 'phone'] },
                    value: { type: 'string' }
                },
                required: ['field', 'value']
            },
            handler: async ({ field, value }) => saveContactInfo?.(field, value) ?? { ok: false }
        }
    ];
}
