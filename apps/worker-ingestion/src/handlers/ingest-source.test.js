import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';

// Small, real, standards-valid PDF (proper objects + xref table) so the
// PDF-signature branch is exercised against the real pdf-parse/pdfjs-dist
// stack instead of a mock — extractDocumentText resolves `pdf-parse` via
// `createRequire`, which bypasses vitest's `vi.mock` interception entirely,
// so mocking it would silently test nothing.
function buildMinimalPdfBuffer() {
    const objs = {
        1: '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        2: '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        3: '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>\nendobj\n'
    };
    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 1; i <= 3; i++) {
        offsets[i] = Buffer.byteLength(body, 'latin1');
        body += objs[i];
    }
    const xrefStart = Buffer.byteLength(body, 'latin1');
    let xref = 'xref\n0 4\n0000000000 65535 f \n';
    for (let i = 1; i <= 3; i++) {
        xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    body += xref;
    body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(body, 'latin1');
}

function makeZip(files) {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(files)) {
        zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'));
    }
    return zip.toBuffer();
}

vi.mock('@repo/database', () => ({
    KnowledgeSource: { create: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn() },
    Product: { findById: vi.fn() }
}));
// extractDocumentText lives in @repo/rag too (packages/rag/src/document-text.js)
// — only ingestSource is mocked here, extractDocumentText (and its real
// pdf-parse/mammoth stack, see the comment on buildMinimalPdfBuffer above)
// stays the genuine implementation.
vi.mock('@repo/rag', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, ingestSource: vi.fn() };
});
vi.mock('@repo/ai', () => ({ describeImage: vi.fn(), transcribeAudio: vi.fn() }));
vi.mock('@repo/storage', () => ({ presignDownload: vi.fn() }));
vi.mock('@repo/realtime', () => ({
    publishEvent: vi.fn().mockResolvedValue(undefined),
    RT_EVENTS: { INGESTION_PROGRESS: 'ingestion:progress', INGESTION_READY: 'ingestion:ready' }
}));
vi.mock('@repo/utils', () => ({ decryptField: vi.fn() }));
vi.mock('../extractors/url.js', () => ({ extractFromUrl: vi.fn() }));
vi.mock('fluent-ffmpeg', () => ({ default: Object.assign(vi.fn(), { setFfmpegPath: vi.fn(), setFfprobePath: vi.fn() }) }));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }));

const { KnowledgeSource } = await import('@repo/database');
const { ingestSource } = await import('@repo/rag');
const mammoth = (await import('mammoth')).default;
const { extractDocumentText, ingestZipEntries } = await import('./ingest-source.js');

beforeEach(() => {
    vi.clearAllMocks();
    let counter = 0;
    KnowledgeSource.create.mockImplementation(async (doc) => ({ _id: `child-${++counter}`, ...doc }));
    // Real Mongoose findByIdAndUpdate() always returns a thenable Query;
    // ingestZipEntries() now `.catch()`es it directly (to persist
    // meta.extractedText before embedding), so the mock needs to resolve
    // too, or that chain throws synchronously on the plain vi.fn() default.
    KnowledgeSource.findByIdAndUpdate.mockResolvedValue({});
    ingestSource.mockResolvedValue({ chunks: 1 });
});

describe('extractDocumentText', () => {
    it.each(['txt', 'md', 'markdown', 'mdx', 'json', 'xml'])(
        'reads .%s as plain utf-8 text, as-is',
        async (ext) => {
            const text = await extractDocumentText(Buffer.from('hello world', 'utf-8'), { ext });
            expect(text).toBe('hello world');
        }
    );

    it('treats a text/* mime as plain text even with no recognized extension', async () => {
        const text = await extractDocumentText(Buffer.from('plain', 'utf-8'), { mime: 'text/csv', ext: 'csv' });
        expect(text).toBe('plain');
    });

    it('routes .docx to mammoth and returns its extracted text', async () => {
        mammoth.extractRawText.mockResolvedValue({ value: 'docx contents' });
        const buffer = Buffer.from('fake docx bytes');

        const text = await extractDocumentText(buffer, { ext: 'docx' });

        expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer });
        expect(text).toBe('docx contents');
    });

    it('routes a wordprocessingml mime to mammoth even without a .docx extension', async () => {
        mammoth.extractRawText.mockResolvedValue({ value: 'docx via mime' });

        const text = await extractDocumentText(Buffer.from('x'), {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ext: 'bin'
        });

        expect(text).toBe('docx via mime');
    });

    it('parses a real PDF by magic-byte signature, ignoring a mislabeled mime/extension', async () => {
        // The mime/ext below both lie about the file being a .docx — the
        // `%PDF-` signature check must win regardless.
        const text = await extractDocumentText(buildMinimalPdfBuffer(), {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ext: 'docx'
        });
        expect(typeof text).toBe('string');
        expect(mammoth.extractRawText).not.toHaveBeenCalled();
    });

    it('throws a clear error for an unsupported/corrupt format', async () => {
        await expect(
            extractDocumentText(Buffer.from([0x00, 0x01, 0x02]), { mime: 'application/octet-stream', ext: 'bin' })
        ).rejects.toThrow(/Desteklenmeyen veya bozuk dosya formatı/);
    });
});

describe('ingestZipEntries', () => {
    it('ingests each supported member as its own KnowledgeSource and reports the summary', async () => {
        const buffer = makeZip({
            'notes.txt': 'hello',
            'readme.md': '# hi',
            'data.json': '{"a":1}'
        });

        const summary = await ingestZipEntries({ buffer, parentSourceId: 'parent-1', productId: 'prod-1' });

        expect(summary.total).toBe(3);
        expect(summary.ingested).toBe(3);
        expect(summary.failed).toEqual([]);
        expect(summary.skipped).toEqual([]);
        expect(KnowledgeSource.create).toHaveBeenCalledTimes(3);
        expect(ingestSource).toHaveBeenCalledTimes(3);
    });

    it('skips macOS AppleDouble shadow files and __MACOSX metadata without ingesting them', async () => {
        const buffer = makeZip({
            'notes.txt': 'hello',
            '._notes.txt': 'resource fork junk',
            '.DS_Store': 'junk',
            '__MACOSX/notes.txt': 'junk'
        });

        const summary = await ingestZipEntries({ buffer, parentSourceId: 'parent-1', productId: 'prod-1' });

        expect(summary.ingested).toBe(1);
        expect(summary.skipped).toEqual(
            expect.arrayContaining(['._notes.txt', '.DS_Store', '__MACOSX/notes.txt'])
        );
        expect(KnowledgeSource.create).toHaveBeenCalledTimes(1);
    });

    it('skips members with an unsupported extension', async () => {
        const buffer = makeZip({ 'notes.txt': 'hello', 'image.png': Buffer.from([0x89, 0x50]) });

        const summary = await ingestZipEntries({ buffer, parentSourceId: 'parent-1', productId: 'prod-1' });

        expect(summary.ingested).toBe(1);
        expect(summary.skipped).toEqual(['image.png']);
    });

    it('marks only the failing entry as failed and still ingests the rest', async () => {
        const buffer = makeZip({ 'good.txt': 'hello', 'bad.docx': 'not actually a docx' });
        mammoth.extractRawText.mockRejectedValueOnce(new Error('corrupt docx'));

        const summary = await ingestZipEntries({ buffer, parentSourceId: 'parent-1', productId: 'prod-1' });

        expect(summary.ingested).toBe(1);
        expect(summary.failed).toEqual([{ name: 'bad.docx', error: 'corrupt docx' }]);
        expect(KnowledgeSource.findByIdAndUpdate).toHaveBeenCalledWith(
            expect.stringMatching(/^child-/),
            expect.objectContaining({ status: 'failed', error: 'corrupt docx' })
        );
    });

    it('throws if the buffer is not a valid zip', async () => {
        await expect(
            ingestZipEntries({ buffer: Buffer.from('not a zip'), parentSourceId: 'p', productId: 'prod' })
        ).rejects.toThrow(/Zip dosyası açılamadı\/bozuk/);
    });
});

// ZIP_MAX_ENTRY_BYTES / ZIP_MAX_ENTRIES / ZIP_MAX_TOTAL_BYTES are read from
// process.env once, at module-load time — so exercising a specific limit
// means loading a fresh module instance with that env var already set,
// rather than reusing the singleton imported above.
describe('ingestZipEntries — configurable zip limits', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.resetModules();
    });

    // vi.resetModules() also discards the previously-imported mock module
    // instances, so @repo/database's mock factory runs again and returns
    // brand-new, unconfigured vi.fn()s — re-fetch and reconfigure them
    // alongside the fresh ingest-source.js instance.
    async function loadFreshIngestZipEntries() {
        vi.resetModules();
        const { ingestZipEntries: freshIngestZipEntries } = await import('./ingest-source.js');
        const { KnowledgeSource: freshKnowledgeSource } = await import('@repo/database');
        const { ingestSource: freshIngestSource } = await import('@repo/rag');
        let counter = 0;
        freshKnowledgeSource.create.mockImplementation(async (doc) => ({ _id: `child-${++counter}`, ...doc }));
        freshIngestSource.mockResolvedValue({ chunks: 1 });
        return freshIngestZipEntries;
    }

    it('skips a member larger than ZIP_MAX_ENTRY_BYTES', async () => {
        process.env.ZIP_MAX_ENTRY_BYTES = String(10);
        const freshIngestZipEntries = await loadFreshIngestZipEntries();

        const buffer = makeZip({ 'small.txt': 'x', 'big.txt': 'x'.repeat(100) });
        const summary = await freshIngestZipEntries({ buffer, parentSourceId: 'p', productId: 'prod' });

        expect(summary.skipped).toContain('big.txt');
        expect(summary.ingested).toBe(1);
    });

    it('rejects when the number of supported entries exceeds ZIP_MAX_ENTRIES', async () => {
        process.env.ZIP_MAX_ENTRIES = String(2);
        const freshIngestZipEntries = await loadFreshIngestZipEntries();

        const buffer = makeZip({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' });

        await expect(
            freshIngestZipEntries({ buffer, parentSourceId: 'p', productId: 'prod' })
        ).rejects.toThrow(/çok fazla desteklenen dosya/);
    });

    it('rejects when the total declared size of supported entries exceeds ZIP_MAX_TOTAL_BYTES', async () => {
        process.env.ZIP_MAX_TOTAL_BYTES = String(50);
        const freshIngestZipEntries = await loadFreshIngestZipEntries();

        const buffer = makeZip({ 'a.txt': 'x'.repeat(40), 'b.txt': 'x'.repeat(40) });

        await expect(
            freshIngestZipEntries({ buffer, parentSourceId: 'p', productId: 'prod' })
        ).rejects.toThrow(/toplamda çok büyük/);
    });
});
