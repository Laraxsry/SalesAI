import { openai } from './openai-client.js';
import { withTimeout, retryWithJitter } from '@repo/resilience';

const MODEL = () => process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';
const EMBED_TIMEOUT_MS = 30_000;

/** Embeds a single string into a dense vector. */
export async function embed(text) {
    const [vec] = await embedBatch([text]);
    return vec;
}

/**
 * Embeds a batch of strings. Returns an array of vectors.
 * Wrapped in a timeout + bounded retry — the OpenAI SDK's own default
 * timeout/retry is generous enough (minutes) that a rate-limited or stalled
 * request can leave a caller (e.g. zip ingestion) stuck 'processing'
 * indefinitely instead of failing fast and moving on.
 */
export async function embedBatch(texts) {
    if (!texts.length) return [];
    const res = await retryWithJitter(
        () => withTimeout(() => openai().embeddings.create({ model: MODEL(), input: texts }), EMBED_TIMEOUT_MS),
        { attempts: 3 }
    );
    return res.data.map((d) => d.embedding);
}
