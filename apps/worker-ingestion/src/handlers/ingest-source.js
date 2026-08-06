import { KnowledgeSource, Product } from '@repo/database';
import { ingestSource } from '@repo/rag';
import { describeImage, transcribeAudio } from '@repo/ai';
import { presignDownload } from '@repo/storage';
import { publishEvent, RT_EVENTS } from '@repo/realtime';
import { extractFromUrl } from '../extractors/url.js';
import { safeFetch, decryptField } from '@repo/utils';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Node.js 22+ için pdf-parse (pdfjs-dist) DOMMatrix polyfill'i
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {};
}
const { PDFParse } = require('pdf-parse');
import mammoth from 'mammoth';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';

const VIDEO_MAX_KEYFRAMES = Number(process.env.VIDEO_MAX_KEYFRAMES || 6);

// fluent-ffmpeg resolves plain `ffmpeg`/`ffprobe` off PATH, which on a dev
// machine with multiple installs (e.g. an old Anaconda ffmpeg shadowing a
// newer one) can silently pick an incompatible binary — .screenshots() uses
// ffprobe internally to find the video duration, and a stale ffprobe can
// make keyframe extraction fail outright with no useful error surfaced
// higher up. Only overrides when explicitly configured, so prod images that
// install a single correct ffmpeg on PATH are unaffected.
if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

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
            case 'api': {
                await emitProgress(sourceId, 'URL getiriliyor…', 15);
                // Reuse the product's demo-session (same material the guided
                // tour injects) so auth-gated pages get indexed with their
                // real content instead of the anonymous/login view.
                let urlAuth = null;
                const product = await Product.findById(productId).select('demoSession');
                if (product?.demoSession) {
                    try {
                        urlAuth = JSON.parse(decryptField(product.demoSession));
                    } catch (err) {
                        console.warn('[ingest-source] demoSession decrypt failed, crawling anonymously:', err.message);
                    }
                }
                text = await extractFromUrl(source.url, urlAuth, (current, max) => {
                    const pct = 15 + Math.round((current / max) * 35); // 15%..50%
                    emitProgress(sourceId, `Sayfa ${current}/${max} taranıyor…`, pct).catch(() => {});
                });
                modality = 'web';
                await emitProgress(sourceId, 'URL içeriği alındı', 50);
                break;
            }

            case 'image': {
                await emitProgress(sourceId, 'Görsel indiriliyor…', 15);
                const url = source.fileKey ? await presignDownload(source.fileKey) : source.url;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to download image: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const contentType = source.mimeType || response.headers.get('content-type') || 'image/png';
                const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

                await emitProgress(sourceId, 'Görsel analiz ediliyor (Vision AI)…', 30);
                text = await describeImage(dataUrl);
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
                    const parser = new PDFParse({ data: buffer });
                    await parser.load();
                    const parsed = await parser.getText();
                    text = parsed.text;
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
                await KnowledgeSource.findByIdAndUpdate(sourceId, { 'meta.transcript': transcriptResult.text });
                await emitProgress(sourceId, 'Transkripsiyon tamamlandı', 55);

                // 4. Video karelerini örnekle ve Vision AI ile açıkla (sessiz/anlatımsız
                // videolarda transkript tek başına yeterli bilgi vermiyor).
                const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frames_'));
                let frameCaptions = [];
                try {
                    const frameFiles = await new Promise((resolve, reject) => {
                        const filenames = [];
                        ffmpeg(videoPath)
                            .on('filenames', (names) => filenames.push(...names))
                            .on('end', () => resolve(filenames))
                            .on('error', reject)
                            .screenshots({ count: VIDEO_MAX_KEYFRAMES, folder: frameDir, filename: 'frame-%i.png', size: '1024x?' });
                    });
                    await emitProgress(sourceId, 'Video kareleri analiz ediliyor…', 60);

                    const results = await Promise.allSettled(
                        frameFiles.map(async (filename) => {
                            const pngBuffer = await fs.readFile(path.join(frameDir, filename));
                            return describeImage(
                                `data:image/png;base64,${pngBuffer.toString('base64')}`,
                                'Describe what is shown on screen in this video frame.'
                            );
                        })
                    );
                    frameCaptions = results
                        .filter((r) => r.status === 'fulfilled')
                        .map((r) => r.value);

                    // Promise.allSettled swallows per-frame rejections silently — if every
                    // frame failed (e.g. vision API error), frameCaptions ends up empty with
                    // no signal anywhere. Surface it: console for live debugging, and
                    // KnowledgeSource.meta so it's visible later via Compass without needing
                    // the worker's terminal output.
                    const rejected = results.filter((r) => r.status === 'rejected');
                    if (rejected.length > 0) {
                        console.warn(
                            `[ingest-source] ${rejected.length}/${frameFiles.length} frame descriptions failed:`,
                            rejected[0].reason?.message
                        );
                    }
                    await KnowledgeSource.findByIdAndUpdate(sourceId, {
                        'meta.frameCount': frameFiles.length,
                        'meta.frameCaptionCount': frameCaptions.length,
                        ...(rejected.length > 0 && { 'meta.frameCaptionError': rejected[0].reason?.message })
                    }).catch(() => {});
                } catch (err) {
                    console.warn('[ingest-source] keyframe extraction failed, continuing with transcript only:', err.message);
                    await KnowledgeSource.findByIdAndUpdate(sourceId, {
                        'meta.frameExtractionError': err.message
                    }).catch(() => {});
                } finally {
                    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
                }

                text = [transcriptResult.text, ...frameCaptions.map((c, i) => `[Frame ${i + 1}]: ${c}`)].join('\n\n');
                modality = 'video';
                await emitProgress(sourceId, 'Video analizi tamamlandı', 65);
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
