import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// DOMMatrix polyfill for pdf-parse (pdfjs-dist) on Node.js 22+
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {};
}
const { PDFParse } = require('pdf-parse');
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';

/**
 * Converts a document buffer to text using an actual magic-byte check first,
 * falling back to mime/extension. A genuine `%PDF-` signature always wins —
 * even if the mime/extension claims something else (e.g. a PDF mistakenly
 * uploaded/named as .docx) — since the real bytes are strictly more reliable
 * than a client-supplied label. Only once the signature check rules out PDF
 * do mime/extension decide between docx and plain text; an unrecognized
 * format still throws a clear error instead of pdf-parse's vague "Invalid
 * PDF structure". Shared by standalone document sources, zip members
 * (apps/worker-ingestion), and the Console detail modal's on-demand re-
 * extraction for sources that predate `meta.extractedText` persistence
 * (apps/api/src/routes/knowledge.js) — the latter needs the exact same
 * paragraph-preserving output as ingestion, not the whitespace-collapsed
 * text `chunkText()` produces for retrieval.
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
 * Re-extracts a single member's text out of a zip archive buffer. Zip
 * children (`KnowledgeSource.parentSourceId` set) never got their own
 * `fileKey` — the parent zip's bytes are the only surviving copy of their
 * content (see `ingestZipEntries` in
 * apps/worker-ingestion/src/handlers/ingest-source.js) — so recovering their
 * paragraph-preserving text for sources ingested before
 * `meta.extractedText` persistence existed means re-opening the parent zip,
 * not the member alone.
 *
 * @param {Buffer} zipBuffer
 * @param {string} entryName - matches `KnowledgeSource.meta.zipEntry`
 * @returns {Promise<string>}
 */
export async function extractZipMemberText(zipBuffer, entryName) {
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntry(entryName);
    if (!entry) {
        throw new Error(`Zip içinde "${entryName}" bulunamadı`);
    }
    const ext = entryName.split('.').pop()?.toLowerCase();
    return extractDocumentText(entry.getData(), { ext });
}
