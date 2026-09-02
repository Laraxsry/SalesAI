/**
 * Unit test — createHandQueue (apps/agent-worker/src/hand-queue.js)
 *
 * No DB/network dependency. Görev #11 — the raised-hand queue that the agent
 * works through with the `next_participant` tool.
 *
 * Run: node backend_tests/unit/hand-queue.mjs
 */
import assert from 'node:assert/strict';
import { createHandQueue } from '../../apps/agent-worker/src/hand-queue.js';

let passed = 0;
let failed = 0;
function ok(l) {
    console.log(`  ✅ ${l}`);
    passed++;
}
function fail(l, r) {
    console.error(`  ❌ ${l}`);
    if (r) console.error(`     ${r}`);
    failed++;
}

console.log('\n🧪 Unit — hand-queue\n');

try {
    const q = createHandQueue();
    assert.ok(q.isEmpty());
    q.raise('visitor_a');
    q.raise('visitor_b');
    q.raise('visitor_a'); // dedupe
    q.raise('');
    q.raise(null);
    assert.equal(q.size, 2);
    assert.deepEqual(q.list(), ['visitor_a', 'visitor_b']);
    ok('raise: FIFO, dedupe, boş/null yok sayılır');
} catch (e) {
    fail('raise', e.message);
}

try {
    const q = createHandQueue();
    q.raise('visitor_a');
    q.raise('visitor_b');
    q.raise('visitor_c');
    q.lower('visitor_b');
    assert.deepEqual(q.list(), ['visitor_a', 'visitor_c']);
    assert.equal(q.shift(), 'visitor_a');
    assert.deepEqual(q.list(), ['visitor_c']);
    assert.equal(q.shift(), 'visitor_c');
    assert.equal(q.shift(), null);
    assert.ok(q.isEmpty());
    ok('lower / shift / boş kuyrukta shift → null');
} catch (e) {
    fail('lower/shift', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
