import { KnowledgeSource, Product } from '@repo/database';
import { ingestSource } from '@repo/rag';
import { describeImage, transcribeAudio } from '@repo/ai';
import { presignDownload } from '@repo/storage';
import { publishEvent, RT_EVENTS } from '@repo/realtime';
import { extractFromUrl } from '../extractors/url.js';
import { decryptField } from '@repo/utils';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// DOMMatrix polyfill for pdf-parse (pdfjs-dist) on Node.js 22+
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {};
}
const { PDFParse } = require('pdf-parse');
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
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

// .zip sources: each archive member is ingested as its own KnowledgeSource
// (see ingestZipEntries). These limits are a simple upper bound against the
// zip-bomb / oversized-archive risk — we trust adm-zip's own local-header
// sizes, and the actual decompression happens one entry at a time (never
// the whole archive into RAM at once).
const ZIP_SUPPORTED_EXTS = new Set(['pdf', 'docx', 'txt', 'md', 'markdown', 'mdx', 'json', 'xml']);
const ZIP_MAX_ENTRIES = Number(process.env.ZIP_MAX_ENTRIES || 1000);
const ZIP_MAX_ENTRY_BYTES = Number(process.env.ZIP_MAX_ENTRY_BYTES || 25 * 1024 * 1024); // 25MB/dosya
const ZIP_MAX_TOTAL_BYTES = Number(process.env.ZIP_MAX_TOTAL_BYTES || 500 * 1024 * 1024); // 500MB toplam

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
 * Converts a document buffer to text using an actual magic-byte check first,
 * falling back to mime/extension. A genuine `%PDF-` signature always wins —
 * even if the mime/extension claims something else (e.g. a PDF mistakenly
 * uploaded/named as .docx) — since the real bytes are strictly more reliable
 * than a client-supplied label. Only once the signature check rules out PDF
 * do mime/extension decide between docx and plain text; an unrecognized
 * format still throws a clear error instead of pdf-parse's vague "Invalid
 * PDF structure". Shared by both standalone document sources and each file
 * inside a zip.
 *
 * @param {Buffer} buffer
 * @param {{ mime?: string, ext?: string }} info
 * @returns {Promise<string>}
 */
export async function extractDocumentText(buffer, { mime = '', ext = '' } = {}) {
    const isPdfBySignature = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    const isDocx =
        !isPdfBySignature &&
        (mime.includes('wordprocessingml') || mime.includes('msword') || ext === 'docx');
    const isPlainText =
        !isPdfBySignature &&
        !isDocx &&
        (mime.startsWith('text/') || ext === 'md' || ext === 'txt' || ext === 'markdown' || ext === 'mdx' ||
            ext === 'json' || ext === 'xml');

    if (isPdfBySignature) {
        const parser = new PDFParse({ data: buffer });
        await parser.load();
        const parsed = await parser.getText();
        return parsed.text;
    }
    if (isDocx) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    }
    if (isPlainText) {
        return buffer.toString('utf-8');
    }
    throw new Error(
        `Desteklenmeyen veya bozuk dosya formatı (mimeType: "${mime || 'bilinmiyor'}", uzantı: "${ext || 'yok'}"). ` +
        'Desteklenen formatlar: PDF, DOCX, TXT, MD, MDX, JSON, XML.'
    );
}

/**
 * Opens a .zip archive, creates a separate KnowledgeSource for each
 * supported member (pdf/docx/txt/md/mdx/json/xml), and vectorizes each one
 * individually via ingestSource(). Since `store.deleteBySource()` deletes
 * one sourceId's chunks per call (see packages/rag/src/ingest.js), we ingest
 * each file under its own sourceId instead of concatenating all members into
 * one text and making a single call (like the URL crawl does) — this way
 * each file shows up as its own row with its own ready/failed status in the
 * Knowledge list, and chat citations point to the correct file.
 *
 * @param {{ buffer: Buffer, parentSourceId: string, productId: string }} args
 */
export async function ingestZipEntries({ buffer, parentSourceId, productId }) {
    let zip;
    try {
        zip = new AdmZip(buffer);
    } catch (err) {
        throw new Error(`Zip dosyası açılamadı/bozuk: ${err.message}`);
    }

    const allEntries = zip.getEntries().filter((e) => !e.isDirectory);

    // Filter first, then apply the limits only to files that will actually
    // be decompressed and processed (the supported ones) — it doesn't matter
    // how many images/folders/other "noise" the zip contains, those are
    // already skipped and never opened.
    const supported = [];
    const skipped = [];
    for (const entry of allEntries) {
        const baseName = entry.entryName.split('/').pop();
        // macOS adds a `._foo.ext` AppleDouble (resource fork) shadow file next to
        // every real file when zipping a folder, plus a `__MACOSX/` directory. Same
        // extension as the real file, so it would otherwise pass the filter below and
        // get ingested as a bogus duplicate source with binary garbage as its "text".
        const isMacMetadata =
            baseName === '.DS_Store' ||
            baseName.startsWith('._') ||
            entry.entryName.startsWith('__MACOSX/');
        const entryExt = baseName.split('.').pop()?.toLowerCase();
        if (isMacMetadata || !ZIP_SUPPORTED_EXTS.has(entryExt) || (entry.header?.size || 0) > ZIP_MAX_ENTRY_BYTES) {
            skipped.push(entry.entryName);
            continue;
        }
        supported.push(entry);
    }

    if (supported.length > ZIP_MAX_ENTRIES) {
        throw new Error(
            `Zip içinde işlenecek çok fazla desteklenen dosya var (${supported.length}, limit: ${ZIP_MAX_ENTRIES}).`
        );
    }

    const declaredSupportedSize = supported.reduce((sum, e) => sum + (e.header?.size || 0), 0);
    if (declaredSupportedSize > ZIP_MAX_TOTAL_BYTES) {
        throw new Error(
            `Zip içindeki desteklenen dosyalar toplamda çok büyük (~${Math.round(declaredSupportedSize / 1024 / 1024)}MB, ` +
            `limit: ${Math.round(ZIP_MAX_TOTAL_BYTES / 1024 / 1024)}MB).`
        );
    }

    const summary = { total: allEntries.length, ingested: 0, failed: [], skipped };

    for (let i = 0; i < supported.length; i++) {
        const entry = supported[i];
        const baseName = entry.entryName.split('/').pop();
        const entryExt = entry.entryName.split('.').pop()?.toLowerCase();

        await emitProgress(
            parentSourceId,
            `Zip: ${baseName} işleniyor… (${i + 1}/${supported.length})`,
            20 + Math.round(((i + 1) / supported.length) * 60)
        );

        // Every entry is created up front so it shows up as its own row in
        // the Knowledge list (as 'failed' if needed) even if extraction fails.
        const child = await KnowledgeSource.create({
            productId,
            type: 'document',
            title: baseName,
            status: 'processing',
            meta: { zipParent: parentSourceId, zipEntry: entry.entryName }
        });

        try {
            const entryBuffer = entry.getData();
            const entryText = await extractDocumentText(entryBuffer, { ext: entryExt });
            await ingestSource({ sourceId: child._id, productId, text: entryText, modality: 'text' });
            summary.ingested += 1;
            await emitProgress(child._id.toString(), 'Hazır', 100);
        } catch (err) {
            await KnowledgeSource.findByIdAndUpdate(child._id, { status: 'failed', error: err.message });
            summary.failed.push({ name: entry.entryName, error: err.message });
            await emitProgress(child._id.toString(), 'Başarısız', 100);
        }
    }

    return summary;
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

    // Used to clean up temporary files
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

                // Check mimeType first (comes from the client), fall back to the extension
                const mime = source.mimeType || '';
                const ext  = (source.fileKey || '').split('.').pop()?.toLowerCase();
                const isZip = ext === 'zip' || mime.includes('zip');

                if (isZip) {
                    // Zip: each member is ingested as its own KnowledgeSource (see the
                    // note at the top of ingestZipEntries — we don't roll them all up
                    // under one sourceId because of deleteBySource). So we bypass the
                    // switch's usual flow (one `text` -> one ingestSource call) and
                    // return early here.
                    await emitProgress(sourceId, 'Zip arşivi taranıyor…', 20);
                    const summary = await ingestZipEntries({ buffer, parentSourceId: sourceId, productId });
                    await KnowledgeSource.findByIdAndUpdate(sourceId, {
                        status: 'ready',
                        meta: { zipSummary: summary }
                    });
                    await publishEvent(RT_EVENTS.INGESTION_READY, {
                        sourceId,
                        productId,
                        chunks: 0,
                        modality: 'zip',
                        meta: summary
                    }).catch(() => {});
                    await cleanup();
                    return summary;
                }

                await emitProgress(sourceId, 'Doküman ayrıştırılıyor…', 35);
                text = await extractDocumentText(buffer, { mime, ext });
                await emitProgress(sourceId, 'Doküman metni çıkarıldı', 55);
                break;
            }

            case 'video': {
                if (!source.fileKey) throw new Error('Video source requires a fileKey');
                await emitProgress(sourceId, 'Video indiriliyor…', 10);
                const url = await presignDownload(source.fileKey);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);

                // 1. Download the video to a temporary file
                const videoPath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
                tempFiles.push(videoPath);
                await pipeline(response.body, createWriteStream(videoPath));
                await emitProgress(sourceId, 'Video indirildi, ses çıkarılıyor…', 25);

                // 2. Extract the audio from the video with ffmpeg (as mp3)
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

                // 3. Transcribe the audio to text with OpenAI Whisper
                const transcriptResult = await transcribeAudio(audioPath);
                await KnowledgeSource.findByIdAndUpdate(sourceId, { 'meta.transcript': transcriptResult.text });
                await emitProgress(sourceId, 'Transkripsiyon tamamlandı', 55);

                // 4. Sample video keyframes and describe them with Vision AI (a
                // transcript alone isn't enough signal for silent/narration-free videos).
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

        // Publish completion
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
