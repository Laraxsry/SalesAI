import { KnowledgeChunk } from '@repo/database';
import { Types } from 'mongoose';

/**
 * Vector store backed by MongoDB Atlas Vector Search.
 * Chunks (text + embedding) live in the `knowledgechunks` collection and are
 * queried with the `$vectorSearch` aggregation stage against `vector_index`.
 */
export class MongoVectorStore {
    /**
     * @param {Array<{productId:string, sourceId:string, text:string, embedding:number[], modality?:string, metadata?:object}>} items
     */
    async upsert(items) {
        if (!items.length) return;
        await KnowledgeChunk.insertMany(items);
    }

    /**
     * @param {{ productId:string, embedding:number[], topK?:number, modality?:string }} q
     * @returns {Promise<Array<{id:string, sourceId:string, text:string, score:number, metadata?:object}>>}
     */
    async query({ productId, embedding, topK = 8, modality }) {
        // $vectorSearch filter requires exact type matching — cast to ObjectId
        const filter = { productId: new Types.ObjectId(productId) };
        if (modality) filter.modality = modality;

        const results = await KnowledgeChunk.aggregate([
            {
                $vectorSearch: {
                    index: 'vector_index',
                    path: 'embedding',
                    queryVector: embedding,
                    numCandidates: Math.max(100, topK * 15),
                    limit: topK,
                    filter
                }
            },
            {
                $project: {
                    sourceId: 1,
                    text: 1,
                    metadata: 1,
                    score: { $meta: 'vectorSearchScore' }
                }
            }
        ]);

        return results.map((r) => ({
            id: String(r._id),
            sourceId: String(r.sourceId),
            text: r.text,
            score: r.score,
            metadata: r.metadata
        }));
    }

    async deleteBySource(sourceId) {
        await KnowledgeChunk.deleteMany({ sourceId });
    }

    /**
     * @param {{ productId:string, query:string, topK?:number, modality?:string }} q
     * @returns {Promise<Array<{id:string, sourceId:string, text:string, score:number, metadata?:object}>>}
     */
    async keywordQuery({ productId, query, topK = 8, modality }) {
        const filterOptions = [];
        filterOptions.push({
            equals: {
                path: 'productId',
                value: new Types.ObjectId(productId)
            }
        });
        
        if (modality) {
            filterOptions.push({
                equals: {
                    path: 'modality',
                    value: modality
                }
            });
        }

        const results = await KnowledgeChunk.aggregate([
            {
                $search: {
                    index: 'text_index',
                    compound: {
                        must: [
                            {
                                text: {
                                    query: query,
                                    path: 'text'
                                }
                            }
                        ],
                        filter: filterOptions
                    }
                }
            },
            { $limit: topK },
            {
                $project: {
                    sourceId: 1,
                    text: 1,
                    metadata: 1,
                    score: { $meta: 'searchScore' }
                }
            }
        ]);

        return results.map((r) => ({
            id: String(r._id),
            sourceId: String(r.sourceId),
            text: r.text,
            score: r.score,
            metadata: r.metadata
        }));
    }
}
