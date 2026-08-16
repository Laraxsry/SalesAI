/**
 * Unit test — diffChunks() / multisetEqual() / matchTextsToIds()
 * (packages/rag/src/chunk-diff.js)
 *
 * No DB/network/live-service dependency: pure array-diff logic. This is
 * what lets an edited document only re-embed/re-classify the chunks that
 * actually changed (`reingestSourceIncremental()` in
 * packages/rag/src/ingest.js) instead of the whole source.
 *
 * Run: node backend_tests/unit/chunk-diff.mjs
 */
import assert from 'node:assert/strict';
import { diffChunks, multisetEqual, matchTextsToIds } from '../../packages/rag/src/chunk-diff.js';

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

console.log('\n🧪 Unit — chunk-diff (diffChunks / multisetEqual / matchTextsToIds)\n');

// Identical text → nothing to re-embed.
try {
    const chunks = ['a', 'b', 'c'];
    const { added, removed, unchangedCount } = diffChunks(chunks, chunks);
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
    assert.equal(unchangedCount, 3);
    ok('Aynı chunk dizisi → added/removed boş, hepsi unchanged');
} catch (e) {
    fail('aynı metin', e.message);
}

// One chunk changed in the middle → only that chunk touched, the rest untouched.
try {
    const oldChunks = ['intro', 'middle paragraph', 'conclusion'];
    const newChunks = ['intro', 'edited middle paragraph', 'conclusion'];
    const { added, removed, unchangedCount } = diffChunks(oldChunks, newChunks);
    assert.deepEqual(added, ['edited middle paragraph']);
    assert.deepEqual(removed, ['middle paragraph']);
    assert.equal(unchangedCount, 2);
    ok('Ortadaki tek chunk değişince sadece o eklenip/çıkarılıyor, diğer ikisi unchanged');
} catch (e) {
    fail('tek chunk değişikliği', e.message);
}

// Completely different text → near-total added/removed, no worse than a full re-ingest.
try {
    const oldChunks = ['a', 'b', 'c'];
    const newChunks = ['x', 'y', 'z'];
    const { added, removed, unchangedCount } = diffChunks(oldChunks, newChunks);
    assert.equal(added.length, 3);
    assert.equal(removed.length, 3);
    assert.equal(unchangedCount, 0);
    ok('Komple farklı metin → tüm chunk\'lar added+removed (tam reingest\'ten kötü değil)');
} catch (e) {
    fail('komple farklı metin', e.message);
}

// multisetEqual: order-independent, count-sensitive.
try {
    assert.equal(multisetEqual(['a', 'b'], ['b', 'a']), true);
    assert.equal(multisetEqual(['a', 'a'], ['a']), false);
    assert.equal(multisetEqual(['a', 'b'], ['a', 'c']), false);
    ok('multisetEqual sıradan bağımsız, sayıya duyarlı çalışıyor');
} catch (e) {
    fail('multisetEqual', e.message);
}

// matchTextsToIds: duplicate texts each get a distinct stored id, not the same one twice.
try {
    const existing = [
        { id: 'id1', text: 'dup' },
        { id: 'id2', text: 'dup' },
        { id: 'id3', text: 'unique' }
    ];
    const ids = matchTextsToIds(['dup', 'dup'], existing);
    assert.deepEqual(new Set(ids), new Set(['id1', 'id2']));
    assert.equal(ids.length, 2);
    ok('Tekrarlayan chunk metinleri, aynı id\'yi iki kez değil, farklı id\'lere eşleniyor');
} catch (e) {
    fail('matchTextsToIds duplicate handling', e.message);
}

// matchTextsToIds: no remaining match → throws (signals a multisetEqual bug, not silently ignored).
try {
    let threw = false;
    try {
        matchTextsToIds(['missing'], [{ id: 'id1', text: 'something-else' }]);
    } catch {
        threw = true;
    }
    assert.ok(threw, 'eşleşmeyen metin için hata bekleniyordu');
    ok('Eşleşecek stored id kalmayınca sessizce yutmuyor, hata atıyor');
} catch (e) {
    fail('matchTextsToIds eksik eşleşme', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
