/**
 * Unit test — matchReturningParticipant (apps/agent-worker/src/returning-participant.js)
 *
 * No DB/network dependency. Görev #11 — recognise a visitor who dropped and
 * rejoined the same meeting.
 *
 * Run: node backend_tests/unit/returning-participant.mjs
 */
import assert from 'node:assert/strict';
import { matchReturningParticipant } from '../../apps/agent-worker/src/returning-participant.js';

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

console.log('\n🧪 Unit — returning-participant\n');

const now = new Date();

try {
    const roster = [
        { identity: 'visitor_1', name: 'Ali', visitorKey: 'key-ali', leftAt: now },
        { identity: 'visitor_2', name: 'Ayşe', visitorKey: 'key-ayse', leftAt: null }
    ];
    const m = matchReturningParticipant(roster, { visitorKey: 'key-ali', name: 'Ali' });
    assert.equal(m?.identity, 'visitor_1');
    ok('key eşleşmesi + leftAt → dönüş olarak eşleşir');
} catch (e) {
    fail('key match', e.message);
}

try {
    // hâlâ odada olan biri (leftAt yok) → dönüş sayılmaz
    const roster = [{ identity: 'visitor_1', name: 'Ali', visitorKey: 'key-ali', leftAt: null }];
    assert.equal(matchReturningParticipant(roster, { visitorKey: 'key-ali' }), null);
    ok('leftAt yoksa eşleşmez (hâlâ bağlı)');
} catch (e) {
    fail('still present', e.message);
}

try {
    // key mismatch → isim fallback'e DÜŞMEZ (prior kaydın key'i var)
    const roster = [{ identity: 'visitor_1', name: 'Ali', visitorKey: 'key-old', leftAt: now }];
    assert.equal(matchReturningParticipant(roster, { visitorKey: 'key-new', name: 'Ali' }), null);
    ok('key uyuşmazlığı → isim fallback devreye girmez');
} catch (e) {
    fail('key mismatch', e.message);
}

try {
    // iki taraf da key'siz → isim eşleşmesi (TR normalize)
    const roster = [{ identity: 'visitor_1', name: 'AYŞE', visitorKey: null, leftAt: now }];
    const m = matchReturningParticipant(roster, { name: 'ayşe' });
    assert.equal(m?.identity, 'visitor_1');
    assert.equal(matchReturningParticipant(roster, { name: 'Mehmet' }), null);
    ok('key yoksa → büyük/küçük harf duyarsız isim eşleşmesi');
} catch (e) {
    fail('name fallback', e.message);
}

try {
    assert.equal(matchReturningParticipant([], { visitorKey: 'x' }), null);
    assert.equal(matchReturningParticipant(null, {}), null);
    ok('boş roster / eksik girdi → null');
} catch (e) {
    fail('empty', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
