import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;

async function test() {
    const reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base');
    const query = "hello";
    const docs = ["world", "hello world"];
    
    try {
        const queries = docs.map(() => query);
        const res4 = await reranker(queries, { text_pair: docs });
        console.log("Batch args result:", res4);
    } catch (e) {
        console.error("Batch args failed:", e.message);
    }
}

test();
