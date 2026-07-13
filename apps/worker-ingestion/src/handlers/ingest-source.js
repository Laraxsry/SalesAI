import { KnowledgeSource } from '@repo/database';
import { ingestSource } from '@repo/rag';
import { describeImage, transcribeAudio } from '@repo/ai';
import { presignDownload } from '@repo/storage';
import { publishEvent, RT_EVENTS } from '@repo/realtime';
import { extractFromUrl } from '../extractors/url.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';

/**
 * Emits an ingestion:progress event via Redis → Socket.IO.
 * @param {string} sourceId
 * @param {string} stage      - Human-readable stage label
 * @param {number} [pct=0]    - 0-100 percentage
 */
async function emitProgress(sourceId, stage, pct = 0) {
    await publishEvent(RT_EVENTS.INGESTION_PROGRESS, { sourceId, stage, pct }).catch(() => {});
}

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
        await emitProgress(sourceId, 'Başlatılıyor…', 5);

        switch (source.type) {
            case 'text':
                text = source.content || '';
                await emitProgress(sourceId, 'Metin hazırlandı', 40);
                break;

            case 'url':
            case 'api':
                await emitProgress(sourceId, 'URL getiriliyor…', 15);
                text = await extractFromUrl(source.url);
                modality = 'web';
                await emitProgress(sourceId, 'URL içeriği alındı', 50);
                break;

            case 'image': {
                await emitProgress(sourceId, 'Görsel indiriliyor…', 15);
                const url = source.fileKey ? await presignDownload(source.fileKey) : source.url;
                await emitProgress(sourceId, 'Görsel analiz ediliyor (Vision AI)…', 30);
                text = await describeImage(url);
                modality = 'image';
                await emitProgress(sourceId, 'Görsel analizi tamamlandı', 60);
                break;
            }

            case 'document': {
                if (!source.fileKey) throw new Error('Document source requires a fileKey');
                await emitProgress(sourceId, 'Doküman indiriliyor…', 15);
                const url = await presignDownload(source.fileKey);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to download document: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Önce mimeType'a bak (client'tan gelir), yoksa uzantıya fallback yap
                const mime = source.mimeType || '';
                const ext  = (source.fileKey || '').split('.').pop()?.toLowerCase();
                const isDocx =
                    mime.includes('wordprocessingml') ||
                    mime.includes('msword') ||
                    ext === 'docx';

                if (isDocx) {
                    await emitProgress(sourceId, 'DOCX ayrıştırılıyor (mammoth)…', 35);
                    const result = await mammoth.extractRawText({ buffer });
                    text = result.value;
                } else {
                    // Default: PDF
                    await emitProgress(sourceId, 'PDF ayrıştırılıyor…', 35);
                    const parseResult = await pdfParse(buffer);
                    text = parseResult.text;
                }
                await emitProgress(sourceId, 'Doküman metni çıkarıldı', 55);
                break;
            }

            case 'video': {
                if (!source.fileKey) throw new Error('Video source requires a fileKey');
                await emitProgress(sourceId, 'Video indiriliyor…', 10);
                const url = await presignDownload(source.fileKey);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);

                // 1. Videoyu geçici bir dosyaya indir
                const videoPath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
                tempFiles.push(videoPath);
                await pipeline(response.body, createWriteStream(videoPath));
                await emitProgress(sourceId, 'Video indirildi, ses çıkarılıyor…', 25);

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
                await emitProgress(sourceId, 'Ses Whisper\'a gönderiliyor…', 45);

                // 3. OpenAI Whisper ile sesi metne dök
                const transcriptResult = await transcribeAudio(audioPath);
                text = transcriptResult.text;
                modality = 'video';

                await KnowledgeSource.findByIdAndUpdate(sourceId, { 'meta.transcript': text });
                await emitProgress(sourceId, 'Transkripsiyon tamamlandı', 65);
                break;
            }

            default:
                text = source.content || '';
        }

        await emitProgress(sourceId, 'Vektörleştiriliyor ve kaydediliyor…', 75);
        const result = await ingestSource({ sourceId, productId, text, modality });

        // Tamamlandı bilgisini gönder
        await publishEvent(RT_EVENTS.INGESTION_READY, {
            sourceId,
            productId,
            chunks: result.chunks,
            modality
        }).catch(() => {});

        await cleanup();
        return result;

    } catch (err) {
        await cleanup();
        console.error('[ingest-source] HATA:', err?.message);
        console.error('[ingest-source] STACK:', err?.stack);
        throw err;
    }
}
