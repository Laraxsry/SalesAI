import { pipeline, env } from '@xenova/transformers';

// Disable local models, fetch from Hugging Face hub
env.allowLocalModels = false;

// We use a singleton pattern for the pipeline so we only load it once
class RerankerPipeline {
    static task = 'text-classification';
    static model = 'Xenova/bge-reranker-base';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

/**
 * Reranks an array of documents against a query using a cross-encoder.
 * @param {string} query 
 * @param {Array<{id:string, text:string, score?:number}>} documents 
 * @param {number} topK 
 * @returns {Promise<Array>} Reranked documents
 */
export async function rerank(query, documents, topK = null) {
    if (!documents || documents.length === 0) return [];
    
    // Filter out invalid documents and create pairs
    const validDocs = documents.filter(doc => typeof doc.text === 'string' && doc.text.trim().length > 0);
    if (validDocs.length === 0) return [];

    const reranker = await RerankerPipeline.getInstance();
    
    // Evaluate each document in parallel
    const results = await Promise.all(
        validDocs.map(doc => reranker(query || '', doc.text))
    );
    
    // Attach the new cross-encoder score to the original document
    const scoredDocs = validDocs.map((doc, idx) => {
        // text-classification on a single pair returns an array: [{ label, score }]
        const scoreObj = Array.isArray(results[idx]) ? results[idx][0] : results[idx];
        return {
            ...doc,
            score: scoreObj.score
        };
    });

    // Sort descending by new score
    scoredDocs.sort((a, b) => b.score - a.score);

    if (topK) {
        return scoredDocs.slice(0, topK);
    }
    return scoredDocs;
}
