import { Procedure } from '@repo/database';
import { embedBatch } from '@repo/ai';
import { chunkText } from './chunk.js';
import { UI_KIND } from './chunk-kind.js';
import { renderProcedureText, procedureLabels } from './procedure.js';
import { invalidateProductCache } from './retrieve.js';
import { getVectorStore } from './stores/index.js';

/**
 * Saves a procedure and files its recipe on the dashboard shelf, where retrieval can find it.
 *
 * The structured record (what a demo executes) goes to the `Procedure` collection; the recipe as prose
 * (what retrieval finds) is embedded as chunks of kind 'ui', each pointing back at the record through
 * `metadata.procedureId`. Saving the same procedure again replaces its chunks, so re-learning a flow after
 * the dashboard changes never leaves the old wording behind.
 *
 * @param {{
 *   procedure:object, productId:string, sourceId:string,
 *   describe?:(input:{procedureText:string, language:string})=>Promise<string>
 * }} input
 *   `describe` writes the "what is this for" lines (an LLM call). Without it, or if it returns nothing,
 *   the recipe goes in as written by the template.
 */
/**
 * Load an active recipe for a live demo. The product id is part of the lookup, so one product's agent can
 * never be handed another's recipe by guessing an id.
 */
export async function loadProcedure({ productId, procedureId }) {
    let record;
    try {
        record = await Procedure.findOne({ _id: procedureId, productId, status: 'active' }).lean();
    } catch {
        return null; // not a valid id
    }
    if (!record) return null;
    const procedure = {
        id: String(record._id), title: record.title, language: record.language, pageUrl: record.pageUrl,
        trigger: record.trigger, form: record.form, steps: record.steps, expect: record.expect,
        undo: record.undo, safety: record.safety
    };
    return { procedure, labels: procedureLabels(procedure) };
}

export async function saveProcedure({ procedure, productId, sourceId, describe = null }) {
    const language = procedure.language === 'tr' ? 'Turkish' : 'English';

    let description = '';
    if (describe) {
        description = (await describe({ procedureText: renderProcedureText(procedure), language }).catch(() => '')) || '';
    }
    const text = renderProcedureText(procedure, { description });
    const chunks = chunkText(text);

    const now = new Date();
    const record = await Procedure.findOneAndUpdate(
        { productId, slug: procedure.slug },
        {
            $set: {
                productId,
                sourceId,
                slug: procedure.slug,
                title: procedure.title,
                kind: procedure.kind,
                language: procedure.language,
                pageUrl: procedure.pageUrl,
                trigger: procedure.trigger,
                form: procedure.form,
                steps: procedure.steps,
                expect: procedure.expect,
                undo: procedure.undo,
                safety: procedure.safety,
                description,
                descriptionSource: description ? 'llm' : 'template',
                status: 'active',
                version: procedure.version,
                learnedAt: procedure.learnedAt || now,
                verifiedAt: now
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const store = getVectorStore();
    // Replace, don't add: the recipe may have changed since the last time it was learned.
    if (record.chunkIds?.length) await store.deleteByIds(record.chunkIds.map(String));

    const embeddings = await embedBatch(chunks);
    const ids = await store.upsert(
        chunks.map((chunk, index) => ({
            productId,
            sourceId,
            text: chunk,
            embedding: embeddings[index],
            modality: 'text',
            kind: UI_KIND,
            metadata: { procedureId: String(record._id), procedure: procedure.slug, pageUrl: procedure.pageUrl, trigger: procedure.trigger }
        }))
    );

    await Procedure.updateOne({ _id: record._id }, { $set: { chunkIds: ids } });
    await invalidateProductCache(productId);
    return { procedureId: String(record._id), chunks: ids.length, descriptionSource: description ? 'llm' : 'template' };
}
