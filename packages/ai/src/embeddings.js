import { openai } from './openai-client.js';

const MODEL = () => process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';

/** Embeds a single string into a dense vector. */
export async function embed(text) {
    const [vec] = await embedBatch([text]);
    return vec;
}

/** Embeds a batch of strings. Returns an array of vectors. */
export async function embedBatch(texts) {
    if (!texts.length) return [];
    const res = await openai().embeddings.create({ model: MODEL(), input: texts });
    return res.data.map((d) => d.embedding);
}
