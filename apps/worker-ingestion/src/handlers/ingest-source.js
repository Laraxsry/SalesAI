import { KnowledgeSource } from '@repo/database';
import { ingestSource } from '@repo/rag';
import { describeImage, transcribeAudio } from '@repo/ai';
import { presignDownload } from '@repo/storage';
import { extractFromUrl } from '../extractors/url.js';
import { PDFParse } from 'pdf-parse';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';

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

    // Geçici dosyaları temizlemek için kullanılacak
    const tempFiles = [];
    const cleanup = async () => {
        for (const file of tempFiles) {
            await fs.unlink(file).catch(() => {});
        }
    };

    try {
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

            case 'document': {
                if (!source.fileKey) throw new Error('Document source requires a fileKey');
                const url = await presignDownload(source.fileKey);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to download document: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
                const parseResult = await parser.getText();
                text = parseResult.text;
                break;
            }

            case 'video': {
                if (!source.fileKey) throw new Error('Video source requires a fileKey');
                const url = await presignDownload(source.fileKey);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);

                // 1. Videoyu geçici bir dosyaya indir
                const videoPath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
                tempFiles.push(videoPath);
                await pipeline(response.body, createWriteStream(videoPath));

                // 2. ffmpeg ile videodan sesi çıkar (mp3 olarak)
                const audioPath = path.join(os.tmpdir(), `aud_${Date.now()}.mp3`);
                tempFiles.push(audioPath);

                await new Promise((resolve, reject) => {
                    ffmpeg(videoPath)
                        .noVideo()
                        .audioCodec('libmp3lame')
                        .on('end', resolve)
                        .on('error', reject)
                        .save(audioPath);
                });

                // 3. OpenAI Whisper ile sesi metne dök
                const transcriptResult = await transcribeAudio(audioPath);
                text = transcriptResult.text;
                modality = 'video';
                
                // İstersen metni veritabanına meta olarak da kaydedebiliriz:
                await KnowledgeSource.findByIdAndUpdate(sourceId, { 'meta.transcript': text });
                break;
            }

            default:
                text = source.content || '';
        }

        const result = await ingestSource({ sourceId, productId, text, modality });
        await cleanup();
        return result;

    } catch (err) {
        await cleanup();
        console.error('[ingest-source] HATA:', err?.message);
        console.error('[ingest-source] STACK:', err?.stack);
        // Hata durumunu RAG modülü veya caller ele alacak
        throw err;
    }
}
