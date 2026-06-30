import OpenAI from 'openai';

let client;

/** Lazily-created shared OpenAI client. */
export function openai() {
    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
}
