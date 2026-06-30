import { KnowledgeSource } from '@repo/database';
import { ingestSource } from '@repo/rag';
import { describeImage } from '@repo/ai';
import { presignDownload } from '@repo/storage';
import { extractFromUrl } from '../extractors/url.js';

/**
 * Turns a raw knowledge source into indexable text, then hands it to the RAG
 * pipeline (chunk -> embed -> upsert). Modality is preserved for filtered
 * retrieval and citations.
 *
 * @param {{ sourceId:string, productId:string, type:string }} data
 */
export async function handleIngestSource({ sourceId, productId }) {
    const source = await KnowledgeSource.findById(sourceId);
    if (!source) return;

    let text = '';
    let modality = 'text';

    switch (source.type) {
        case 'text':
            text = source.content || '';
            break;

        case 'url':
        case 'api':
            text = await extractFromUrl(source.url);
            modality = 'web';
            break;

        case 'image': {
            const url = source.fileKey ? await presignDownload(source.fileKey) : source.url;
            text = await describeImage(url);
            modality = 'image';
            break;
        }

        case 'document':
            // PDF/DOCX text extraction (pdf-parse / mammoth) — extract then index.
            text = source.content || '';
            break;

        case 'video':
            // Extract audio (ffmpeg) -> transcribe -> sample keyframes -> describe.
            // Transcript + frame descriptions are concatenated as `text`.
            text = source.meta?.transcript || source.content || '';
            modality = 'video';
            break;

        default:
            text = source.content || '';
    }

    return ingestSource({ sourceId, productId, text, modality });
}
