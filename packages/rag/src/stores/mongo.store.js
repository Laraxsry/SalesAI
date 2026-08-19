import { KnowledgeChunk } from '@repo/database';
import { Types } from 'mongoose';

/**
 * How many extra results to ask the index for, so that dropping chunks a
 * knowledge audit retired still leaves topK to return. Chunks predating the
 * audit feature carry no `status` at all and count as active.
 */
const OVERFETCH = 3;

/** Statuses that must never reach the agent. */
const RETIRED = new Set(['superseded', 'excluded']);

/** Drops retired chunks and trims back to the caller's topK. */
function toRetrievable(docs, topK) {
    return docs
        .filter((r) => !RETIRED.has(r.status))
        .slice(0, topK)
        .map((r) => ({
            id: String(r._id),
            sourceId: String(r.sourceId),
            text: r.text,
            score: r.score,
            audience: r.audience,
            metadata: r.metadata
        }));
}

/**
 * Vector store backed by MongoDB Atlas Vector Search.
 * Chunks (text + embedding) live in the `knowledgechunks` collection and are
 * queried with the `$vectorSearch` aggregation stage against `vector_index`.
 */
export class MongoVectorStore {
    /**
     * @param {Array<{productId:string, sourceId:string, text:string, embedding:number[], modality?:string, metadata?:object}>} items
     * @returns {Promise<string[]>} ids of the written chunks, in input order —
     *   the knowledge audit needs the id of the curated chunk it just wrote so
     *   the chunks it replaces can point at it.
     */
    async upsert(items) {
        if (!items.length) return [];
        const docs = await KnowledgeChunk.insertMany(items);
        return docs.map((d) => String(d._id));
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
                    numCandidates: Math.max(100, topK * OVERFETCH * 15),
                    // Retired chunks are filtered out below rather than inside
                    // the $vectorSearch filter: filtering there needs `status`
                    // declared as a filter field in the Atlas index, and a
                    // deployment that hasn't re-run `npm run db:indexes` would
                    // not degrade — every query would error and the agent would
                    // stop answering entirely. Over-fetching costs one cheap
                    // widened ANN search and cannot break an existing index.
                    limit: topK * OVERFETCH,
                    filter
                }
            },
            {
                $project: {
                    sourceId: 1,
                    text: 1,
                    metadata: 1,
                    audience: 1,
                    status: 1,
                    score: { $meta: 'vectorSearchScore' }
                }
            }
        ]);

        return toRetrievable(results, topK);
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
            { $limit: topK * OVERFETCH }, // see OVERFETCH — retired chunks are dropped below
            {
                $project: {
                    sourceId: 1,
                    text: 1,
                    metadata: 1,
                    audience: 1,
                    status: 1,
                    score: { $meta: 'searchScore' }
                }
            }
        ]);

        return toRetrievable(results, topK);
    }

    /**
     * Every active chunk of a product *with its embedding* — the input to a
     * knowledge audit, which needs the vectors themselves to find near-
     * duplicates without paying for a fresh embedding pass.
     *
     * @param {{ productId:string, limit?:number }} q
     * @returns {Promise<Array<{id:string, sourceId:string, text:string, embedding:number[], audience?:string, createdAt?:Date}>>}
     */
    async listByProduct({ productId, limit = 2000 }) {
        const docs = await KnowledgeChunk.find({
            productId: new Types.ObjectId(productId),
            status: { $nin: [...RETIRED] }
        })
            .select('sourceId text embedding audience createdAt')
            .sort({ createdAt: 1 })
            .limit(limit)
            .lean();

        return docs.map((d) => ({
            id: String(d._id),
            sourceId: String(d.sourceId),
            text: d.text,
            embedding: d.embedding,
            audience: d.audience,
            createdAt: d.createdAt
        }));
    }

    /**
     * Retires (or restores) chunks by id. Used when a knowledge-audit finding
     * is applied; `supersededBy` records which curated chunk replaced them so
     * the decision stays traceable and reversible.
     *
     * @param {{ ids:string[], status:'active'|'superseded'|'excluded', supersededBy?:string }} input
     */
    async setStatus({ ids, status, supersededBy }) {
        if (!ids?.length) return 0;
        const update = supersededBy
            ? { $set: { status, supersededBy: new Types.ObjectId(supersededBy) } }
            : { $set: { status }, $unset: { supersededBy: 1 } };
        const { modifiedCount } = await KnowledgeChunk.updateMany(
            { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
            update
        );
        return modifiedCount;
    }
}
