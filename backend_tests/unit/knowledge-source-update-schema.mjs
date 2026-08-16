/**
 * Unit test — KnowledgeSourceUpdateInput (packages/contracts/src/index.js)
 *
 * Pure Zod schema validation, no DB/network/live-service dependency. Covers
 * the three PATCH /knowledge/:id shapes the route in
 * apps/api/src/routes/knowledge.js branches on: title-only rename,
 * text/extractedText save, and fileKey/mimeType replacement — plus the
 * empty-body rejection that keeps the route from silently no-op'ing.
 *
 * Run: node backend_tests/unit/knowledge-source-update-schema.mjs
 */
import assert from 'node:assert/strict';
import { KnowledgeSourceUpdateInput } from '../../packages/contracts/src/index.js';

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

function expectValid(label, input) {
    try {
        const parsed = KnowledgeSourceUpdateInput.parse(input);
        assert.deepEqual(parsed, input);
        ok(label);
    } catch (e) {
        fail(label, e.message);
    }
}

function expectInvalid(label, input) {
    try {
        KnowledgeSourceUpdateInput.parse(input);
        fail(`${label} (kabul edilmemesi gerekiyordu)`);
    } catch {
        ok(label);
    }
}

console.log('\n🧪 Unit — KnowledgeSourceUpdateInput şeması\n');

expectValid('title-only rename geçerli', { title: 'Yeni başlık' });
expectValid("text tipi için content geçerli", { content: 'Güncellenmiş metin' });
expectValid('doküman için extractedText geçerli', { extractedText: 'Çıkarılmış metin' });
expectValid('dosya değiştirme (fileKey+mimeType) geçerli', {
    fileKey: 'uploads/u1/abc123.pdf',
    mimeType: 'application/pdf'
});
expectInvalid('boş body reddediliyor (.refine)', {});
expectInvalid('bilinmeyen alan tipi reddediliyor', { title: 123 });

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
