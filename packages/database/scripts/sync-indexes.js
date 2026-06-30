import 'dotenv/config';
import { connectDB, mongoose, KnowledgeChunk } from '../src/index.js';

/**
 * Creates the Atlas Vector Search index used by RAG retrieval.
 * Requires MongoDB Atlas (or the `mongodb/mongodb-atlas-local` image) where
 * Atlas Search / Vector Search is available.
 *
 * Embedding dim defaults to 3072 (text-embedding-3-large). Override with
 * EMBEDDING_DIM if you use a different model.
 */
const DIM = Number(process.env.EMBEDDING_DIM || 3072);

async function main() {
    await connectDB();
    const collection = KnowledgeChunk.collection;

    const definition = {
        name: 'vector_index',
        type: 'vectorSearch',
        definition: {
            fields: [
                { type: 'vector', path: 'embedding', numDimensions: DIM, similarity: 'cosine' },
                { type: 'filter', path: 'productId' },
                { type: 'filter', path: 'modality' }
            ]
        }
    };

    try {
        await collection.createSearchIndex(definition);
        console.log(`Created vector_index (dim=${DIM}) on knowledgechunks`);
    } catch (err) {
        if (/already exists/i.test(err.message)) {
            console.log('vector_index already exists, skipping');
        } else {
            throw err;
        }
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
