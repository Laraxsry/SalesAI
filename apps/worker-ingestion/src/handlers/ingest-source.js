import { KnowledgeSource, Product, Agent, KnowledgeChunk } from '@repo/database';
import { ingestSource, extractDocumentText } from '@repo/rag';
import { describeImage, transcribeAudio, synthesizePage, synthesizeOverview } from '@repo/ai';
import { presignDownload } from '@repo/storage';
import { publishEvent, RT_EVENTS } from '@repo/realtime';
import { extractFromUrl } from '../extractors/url.js';
import { decryptField, languageName, mapWithConcurrency } from '@repo/utils';
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
 * Vision (`describeImage()`) prompts default to English regardless of the
 * product's actual language — a Turkish product's PDF/DOCX sources come out
 * Turkish for free (they're just the source text, no prompt involved), but
 * an image/video keyframe caption always came back English, a real
 * consistency risk (the agent could switch languages mid-conversation
 * quoting one). `KnowledgeSource` has no language of its own — it's scoped
 * to a `Product`, which can have multiple `Agent`s, each with their own
 * `persona.language` — so this picks the earliest-created agent for the
 * product as the best available signal and falls back to English if the
 * product has none yet (nothing to disagree with).
 *
 * @param {string} productId
 * @returns {Promise<string>} ISO language code, e.g. 'tr'
 */
async function resolveKnowledgeLanguage(productId) {
    const agent = await Agent.findOne({ productId }).sort({ createdAt: 1 }).select('persona.language');
    return agent?.persona?.language || 'en';
}

// Bound on concurrent synthesizePage() calls during a URL crawl's synthesis
// pass — a 40-page crawl (see MAX_CRAWL_PAGES in extractors/url.js) calling
// an LLM once per page serially would be slow, and firing all of them at
// once risks tripping provider rate limits.
const URL_SYNTHESIS_CONCURRENCY = Number(process.env.URL_SYNTHESIS_CONCURRENCY || 5);

// extractDocumentText() now lives in @repo/rag (packages/rag/src/document-text.js)
// — apps/api's Knowledge detail-content backfill needs the exact same
// paragraph-preserving extraction to re-derive `meta.extractedText` for
// sources that predate its persistence, and re-exporting keeps every
// existing import of it from this file (incl. backend_tests/unit) working
// unchanged.
export { extractDocumentText } from '@repo/rag';

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
            parentSourceId,
            meta: { zipEntry: entry.entryName }
        });

        try {
            const entryBuffer = entry.getData();
            const entryText = await extractDocumentText(entryBuffer, { ext: entryExt });
            // Zip children have no fileKey (the original bytes only ever
            // lived inside the parent archive) — this is the only copy of
            // their content, and what the Console detail modal edits.
            await KnowledgeSource.findByIdAndUpdate(child._id, { 'meta.extractedText': entryText }).catch(() => {});
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
export async function handleIngestSource({ sourceId, productId, generation }) {
    const source = await KnowledgeSource.findById(sourceId);
    if (!source) return;

    // A newer ingestion request for this same source (see
    // apps/api/src/lib/ingestion.js's enqueueIngestion()) has already been
    // enqueued and already landed — this job is stale, let the newer one
    // run/win instead of doing redundant (and possibly outdated, e.g.
    // wrong-language) work.
    if (generation !== undefined && (source.meta?.ingestGeneration || 0) > generation) {
        console.log('[ingest-source] eski (superseded) job atlandı:', {
            sourceId,
            jobGeneration: generation,
            currentGeneration: source.meta?.ingestGeneration
        });
        return { chunks: 0, superseded: true };
    }

    let text = '';
    let modality = 'text';
    // url/api only: per-page segments (see extractFromUrl) so each chunk can
    // be tagged with the page it came from (`metadata.pageUrl`) instead of
    // every crawled page being chunked as one undifferentiated blob — lets
    // the Console detail modal group retrieved chunks by page.
    let ingestSegments = null;
    // url/api only: this run's per-page {rawText, links} index, persisted to
    // meta.crawlIndex.pages so the NEXT ingestion of this source can skip
    // re-crawling pages it already knows (see extractFromUrl's
    // `previousPages` param).
    let crawlPagesIndex = null;

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

                // Pages already crawled/chunked in a prior ingestion of this
                // exact source (see extractFromUrl's `previousPages` doc) —
                // e.g. an anonymous crawl at product-creation time, later
                // re-ingested once a demo-session login was configured. This
                // is what lets that re-crawl skip pages it already knows
                // instead of re-fetching the whole site from the root again.
                const previousPages = new Map(Object.entries(source.meta?.crawlIndex?.pages || {}));

                const crawl = await extractFromUrl(
                    source.url,
                    urlAuth,
                    (current, max) => {
                        const pct = 15 + Math.round((current / max) * 35); // 15%..50%
                        emitProgress(sourceId, `Sayfa ${current}/${max} taranıyor…`, pct).catch(() => {});
                    },
                    previousPages
                );
                text = crawl.text;
                crawlPagesIndex = crawl.pagesIndex;
                const crawlLanguage = languageName(await resolveKnowledgeLanguage(productId));

                // Raw per-page segments (unchanged): needed for on-site
                // navigation/citation and as the ground truth for the
                // Console's "Ham içerik" view. Kept even though a
                // synthesized segment is added alongside — the sales
                // assistant still needs the literal data, e.g. exact figures
                // or the page to link a visitor to.
                ingestSegments = crawl.pages.map((p) => ({ text: p.text, metadata: { pageUrl: p.url } }));

                // Previously-synthesized chunks for this source, keyed by
                // page — lets a page whose raw content didn't change (cache
                // hit above) AND whose synthesis language didn't change skip
                // an expensive LLM call and just reuse the old interpretive
                // text, instead of every re-ingestion re-synthesizing every
                // page from scratch.
                const oldSynthChunks = await KnowledgeChunk.find({
                    sourceId,
                    'metadata.synthesized': true
                }).select('text metadata');
                const oldPageSynth = new Map();
                let oldOverview = null;
                for (const c of oldSynthChunks) {
                    if (c.metadata?.scope === 'overview') {
                        oldOverview = { text: c.text, language: c.metadata?.language };
                    } else if (c.metadata?.pageUrl) {
                        oldPageSynth.set(c.metadata.pageUrl, { text: c.text, language: c.metadata?.language });
                    }
                }

                // Synthesized layer: an interpretive paragraph per page (what
                // it's for, what its numbers mean) plus one cross-page
                // overview, so retrieval can also surface an explanation
                // instead of only ever a wall of raw scraped text. Failures
                // are non-fatal (synthesizePage/synthesizeOverview return ''
                // on error) — a synthesis outage shouldn't block ingestion,
                // it just means that page falls back to raw-only.
                await emitProgress(sourceId, 'İçerik yorumlanıyor…', 55);
                const synthesized = await mapWithConcurrency(crawl.pages, URL_SYNTHESIS_CONCURRENCY, async (p) => {
                    const old = oldPageSynth.get(p.url);
                    if (previousPages.has(p.url) && old && old.language === crawlLanguage) {
                        return { url: p.url, summary: old.text, reused: true };
                    }
                    return {
                        url: p.url,
                        summary: await synthesizePage({ pageUrl: p.url, pageText: p.text, language: crawlLanguage }),
                        reused: false
                    };
                });
                for (const { url, summary } of synthesized) {
                    if (summary) {
                        ingestSegments.push({
                            text: summary,
                            metadata: { pageUrl: url, synthesized: true, language: crawlLanguage }
                        });
                    }
                }

                const overviewReusable =
                    crawl.pages.length > 0 &&
                    crawl.pages.every((p) => previousPages.has(p.url)) &&
                    oldOverview &&
                    oldOverview.language === crawlLanguage;
                const overview = overviewReusable
                    ? oldOverview.text
                    : await synthesizeOverview({ pages: crawl.pages, language: crawlLanguage });
                if (overview) {
                    ingestSegments.push({
                        text: overview,
                        metadata: { synthesized: true, scope: 'overview', language: crawlLanguage }
                    });
                }

                const cachedPageCount = crawl.pages.filter((p) => previousPages.has(p.url)).length;
                const reusedSynthCount = synthesized.filter((s) => s.reused).length;
                console.log('[ingest-source] URL crawl özeti:', {
                    toplamSayfa: crawl.pages.length,
                    cacheTenReuseEdilenSayfa: cachedPageCount,
                    yeniTaranan: crawl.pages.length - cachedPageCount,
                    sentezYenidenKullanilan: reusedSynthCount,
                    sentezYenidenYapilan: synthesized.length - reusedSynthCount,
                    overviewReuseEdildi: overviewReusable
                });

                modality = 'web';
                await emitProgress(sourceId, 'URL içeriği alındı', 60);
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
                const imageLanguage = languageName(await resolveKnowledgeLanguage(productId));
                text = await describeImage(dataUrl, `Describe this image in detail for search, in ${imageLanguage}.`);
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

                    const frameLanguage = languageName(await resolveKnowledgeLanguage(productId));
                    const results = await Promise.allSettled(
                        frameFiles.map(async (filename) => {
                            const pngBuffer = await fs.readFile(path.join(frameDir, filename));
                            return describeImage(
                                `data:image/png;base64,${pngBuffer.toString('base64')}`,
                                `Describe what is shown on screen in this video frame, in ${frameLanguage}.`
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

        // Re-check right before persisting (not just at the top): the
        // expensive work above (crawl, LLM synthesis) can take long enough
        // for a newer request to have been enqueued AND already finished
        // meanwhile — writing this job's (now stale) result after that would
        // silently clobber the newer one, e.g. reverting a just-corrected
        // synthesis language back to whatever this older job resolved.
        if (generation !== undefined) {
            const latest = await KnowledgeSource.findById(sourceId).select('meta.ingestGeneration');
            if ((latest?.meta?.ingestGeneration || 0) > generation) {
                console.log('[ingest-source] sonuç yazılmadı — daha yeni bir istek bu kaynağı süpürdü:', {
                    sourceId,
                    jobGeneration: generation,
                    currentGeneration: latest?.meta?.ingestGeneration
                });
                await cleanup();
                return { chunks: 0, superseded: true };
            }
        }

        // Persisted so the Console detail modal can show/edit "what the AI
        // actually knows" without re-downloading and re-extracting the file
        // (transcript/OCR/vision output is otherwise only ever chunked into
        // KnowledgeChunk, never kept on the source itself). url/api sources
        // also persist this crawl's per-page {rawText, links} index so the
        // next ingestion can skip pages it already knows (see
        // extractFromUrl's `previousPages` param).
        await KnowledgeSource.findByIdAndUpdate(sourceId, {
            'meta.extractedText': text,
            ...(crawlPagesIndex && { 'meta.crawlIndex': { pages: crawlPagesIndex } })
        }).catch(() => {});

        await emitProgress(sourceId, 'Vektörleştiriliyor ve kaydediliyor…', 75);
        const result = await ingestSource({ sourceId, productId, text: ingestSegments || text, modality });

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
