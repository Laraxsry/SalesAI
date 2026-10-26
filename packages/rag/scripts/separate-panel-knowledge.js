/**
 * One-off maintenance: files already-ingested logged-in panel sources on the
 * dashboard shelf (`kind: 'ui'`) and undoes what they did to the product's
 * topic documents.
 *
 *   node packages/rag/scripts/separate-panel-knowledge.js                       (dry run, all products)
 *   node packages/rag/scripts/separate-panel-knowledge.js --product <id>        (dry run, one product)
 *   node packages/rag/scripts/separate-panel-knowledge.js --product <id> --apply
 *
 * New panel ingestions already do this (see handleIngestSource); this only
 * repairs data written before that change. Mongo vector store only.
 *
 * Why topics need repair: a topic document is composed from the findings of
 * the crawl that last changed it, so a panel crawl could overwrite a topic
 * that a public-site crawl had written ("Fiyatlandırma" became "$0.11 credits
 * used", read off the demo workspace's usage card). For every topic a panel
 * source contributed to, `--apply`
 *   - deletes it when only panel pages ever fed it (a topic the panel invented,
 *     such as "Telefon Numaraları"), or
 *   - clears its document and source links when public pages fed it too (a
 *     seeded topic such as "Fiyatlandırma").
 * Re-ingest the product's public site afterwards: the topic pass sees a cleared
 * topic as new and rebuilds it from public pages only (page classifications are
 * cached, so this costs one compose call per topic).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
try { process.loadEnvFile(resolve(root, '.env')); } catch { /* env may come from the shell */ }

const { connectDB, disconnectDB, KnowledgeSource, KnowledgeChunk, KnowledgeTopic } = await import('@repo/database');
const { FIXED_TOPICS } = await import('@repo/ai');
const seededSlugs = new Set(FIXED_TOPICS.map((topic) => topic.slug));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const productArg = args.includes('--product') ? args[args.indexOf('--product') + 1] : null;

await connectDB();
try {
    const sourceFilter = { accessMode: 'authenticated', type: { $in: ['url', 'api'] }, ...(productArg && { productId: productArg }) };
    const panels = await KnowledgeSource.find(sourceFilter).select('title productId').lean();
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${panels.length} logged-in panel source(s)`);

    const productIds = [...new Set(panels.map((p) => String(p.productId)))];
    for (const productId of productIds) {
        const panelIds = panels.filter((p) => String(p.productId) === productId).map((p) => p._id);
        const names = panels.filter((p) => String(p.productId) === productId).map((p) => p.title);
        console.log(`\nproduct ${productId}: ${names.length} panel source(s): ${names.join(', ')}`);

        const unshelved = await KnowledgeChunk.countDocuments({ sourceId: { $in: panelIds }, kind: { $exists: false } });
        console.log(`  chunks to move onto the dashboard shelf: ${unshelved}`);

        const affected = await KnowledgeTopic.find({ productId, 'sourcePages.sourceId': { $in: panelIds } })
            .select('title slug body sourcePages').lean();
        console.log(`  topic documents a panel contributed to: ${affected.length}`);
        const plan = affected.map((topic) => {
            const fromPanel = topic.sourcePages.filter((p) => panelIds.some((id) => String(id) === String(p.sourceId))).length;
            const panelOnly = fromPanel === topic.sourcePages.length && !seededSlugs.has(topic.slug);
            return { topic, fromPanel, action: panelOnly ? 'delete' : 'clear' };
        });
        for (const { topic, fromPanel, action } of plan) {
            console.log(`    - [${action}] ${topic.title}: ${fromPanel} of ${topic.sourcePages.length} contributing pages are panel pages, body ${(topic.body || '').length} chars`);
        }

        if (!apply) continue;

        const moved = await KnowledgeChunk.updateMany(
            { sourceId: { $in: panelIds }, kind: { $exists: false } },
            { $set: { kind: 'ui' } }
        );
        console.log(`  moved ${moved.modifiedCount} chunk(s) to kind 'ui'`);

        for (const { topic, action } of plan) {
            await KnowledgeChunk.deleteMany({ topicId: topic._id });
            if (action === 'delete') {
                await KnowledgeTopic.deleteOne({ _id: topic._id });
            } else {
                await KnowledgeTopic.updateOne(
                    { _id: topic._id },
                    { $set: { body: '', sourcePages: [], lastContributingPages: [], status: 'pending' } }
                );
            }
        }
        const deleted = plan.filter((entry) => entry.action === 'delete').length;
        console.log(`  deleted ${deleted} panel-only topic(s), cleared ${plan.length - deleted} for a public-only rebuild`);

        try {
            const { invalidateProductCache } = await import('../src/retrieve.js');
            await invalidateProductCache(productId);
        } catch (error) {
            console.warn(`  could not clear the retrieval cache (entries expire on their own): ${error.message}`);
        }
    }

    if (!apply) console.log('\nNothing was changed. Re-run with --apply to perform the steps above.');
    else console.log('\nDone. Re-ingest the product\'s public site so the cleared topics are rebuilt from public pages.');
} finally {
    await disconnectDB();
}
