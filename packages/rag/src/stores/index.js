import { MongoVectorStore } from './mongo.store.js';
import { QdrantVectorStore } from './qdrant.store.js';

let instance;

/**
 * Returns the configured vector store (strategy pattern).
 * VECTOR_STORE = mongodb (Atlas Vector Search) | qdrant
 */
export function getVectorStore() {
    if (instance) return instance;
    const name = process.env.VECTOR_STORE || 'mongodb';
    instance = name === 'qdrant' ? new QdrantVectorStore() : new MongoVectorStore();
    return instance;
}
