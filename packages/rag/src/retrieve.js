import { embed } from '@repo/ai';
import { getVectorStore } from './stores/index.js';

/**
 * Retrieves the most relevant knowledge chunks for a query.
 * @param {{ productId:string, query:string, topK?:number, modality?:string }} input
 * @returns {Promise<Array<{id:string, sourceId:string, text:string, score:number}>>}
 */
export async function retrieve({ productId, query, topK = 8, modality }) {
    const embedding = await embed(query);
    const store = getVectorStore();
    return store.query({ productId, embedding, topK, modality });
}
