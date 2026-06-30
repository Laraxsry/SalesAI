import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { connectDB, mongoose, KnowledgeChunk } from '../src/index.js';

// This script runs with cwd = packages/database (npm workspace), so load the
// monorepo-root .env explicitly rather than relying on the cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

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

    // A search index can only be created on an existing collection.
    await KnowledgeChunk.createCollection().catch(() => {});
    const collection = KnowledgeChunk.collection;

    const db = mongoose.connection.db;
    const exists = await db
        .listCollections({ name: collection.collectionName }, { nameOnly: true })
        .hasNext();
    if (!exists) {
        await db.createCollection(collection.collectionName);
        console.log(`Created collection ${collection.collectionName}`);
    }

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
