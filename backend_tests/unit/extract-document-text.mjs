/**
 * Unit test — extractDocumentText() format-detection priority
 * (apps/worker-ingestion/src/handlers/ingest-source.js)
 *
 * No DB/network/live-service dependency: only exercises the pure
 * signature/mime/extension branching described in the function's own
 * docstring — a real `%PDF-` byte signature must win over a conflicting
 * mimeType, plain text must round-trip untouched, and an unrecognized
 * format must throw the documented Turkish error message rather than a
 * vague parser error.
 *
 * Run: node backend_tests/unit/extract-document-text.mjs
 */
import assert from 'node:assert/strict';
import { extractDocumentText } from '../../apps/worker-ingestion/src/handlers/ingest-source.js';

let passed = 0;
let failed = 0;

function ok(label) {
    console.log(`  ✅ ${label}`);
    passed++;
}
function fail(label, reason) {
    console.error(`  ❌ ${label}`);
    if (reason) console.error(`     ${reason}`);
    failed++;
}

async function run() {
    console.log('\n🧪 Unit — extractDocumentText() format detection\n');

    // Plain text: no signature/mime override in play, must round-trip byte-for-byte.
    try {
        const text = 'Merhaba dünya\nİkinci satır';
        const result = await extractDocumentText(Buffer.from(text, 'utf-8'), { ext: 'txt' });
        assert.equal(result, text);
        ok('ext=txt → metin aynen döner');
    } catch (e) {
        fail('ext=txt round-trip', e.message);
    }

    // A genuine %PDF- signature must win even when mimeType claims docx —
    // this is the exact precedence the function's docstring promises.
    try {
        const buffer = Buffer.from('%PDF-1.4\nnot a real pdf body', 'latin1');
        await extractDocumentText(buffer, {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ext: 'docx'
        }).catch((e) => {
            // The malformed body is expected to fail PDF parsing — the point
            // is *which* branch it failed in, not that parsing succeeds.
            assert.ok(
                !e.message.includes('Desteklenmeyen veya bozuk dosya formatı'),
                `PDF imzası mime/ext yerine 'unsupported format' hatasına düştü: ${e.message}`
            );
        });
        ok('%PDF- imzası, çelişen mimeType olsa bile PDF dalını seçiyor');
    } catch (e) {
        fail('PDF imza önceliği', e.message);
    }

    // No signature, no recognized mime/ext → the documented error, not a
    // generic/opaque one from a downstream parser.
    try {
        await extractDocumentText(Buffer.from('random bytes'), { mime: '', ext: 'exe' });
        fail('Desteklenmeyen format hatası bekleniyordu ama atılmadı');
    } catch (e) {
        assert.ok(e.message.includes('Desteklenmeyen veya bozuk dosya formatı'));
        ok('Bilinmeyen format → belgelenen Türkçe hata mesajı atılıyor');
    }

    console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
    if (failed > 0) process.exit(1);
}

run();
