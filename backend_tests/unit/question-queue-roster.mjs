/**
 * Unit test — createQuestionQueue (apps/agent-worker/src/question-queue.js) +
 * buildRosterNote / buildTurnResponseInstruction / resolveSpeaker
 * (packages/agent/src/roster.js)
 *
 * No DB/network dependency. Görev #11 — group sessions: name people, queue
 * questions asked while the agent is talking, answer them as a batch.
 *
 * Run: node backend_tests/unit/question-queue-roster.mjs
 */
import assert from 'node:assert/strict';
import { createQuestionQueue } from '../../apps/agent-worker/src/question-queue.js';
import {
    buildRosterNote,
    buildTurnResponseInstruction,
    resolveSpeaker
} from '../../packages/agent/src/roster.js';

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

console.log('\n🧪 Unit — question-queue-roster\n');

try {
    const q = createQuestionQueue();
    assert.ok(q.isEmpty());
    q.enqueue({ speaker: 'Ali', text: 'Fiyat ne?' });
    q.enqueue({ speaker: 'Ayşe', text: '  Entegrasyon var mı?  ' });
    q.enqueue({ speaker: 'Ali', text: 'Peki SSO?' });
    q.enqueue({ speaker: null, text: '   ' }); // boş → yok sayılır
    assert.equal(q.size(), 3);
    const drained = q.flush();
    assert.equal(drained.length, 3);
    assert.equal(drained[1].text, 'Entegrasyon var mı?');
    assert.ok(q.isEmpty());
    assert.deepEqual(q.flush(), []);
    ok('queue: enqueue/flush/size, boş metin atlanır, flush temizler');
} catch (e) {
    fail('queue', e.message);
}

try {
    assert.equal(buildRosterNote([]), null);
    assert.equal(buildRosterNote([{ identity: 'v1', name: 'Ali' }]), null);
    const note = buildRosterNote([
        { identity: 'v1', name: 'Ali' },
        { identity: 'v2', name: 'Ayşe' },
        { identity: 'v3', name: '' }
    ]);
    assert.ok(note.includes('Ali'));
    assert.ok(note.includes('Ayşe'));
    assert.ok(!note.includes('v3'));
    assert.ok(/address .*by name/i.test(note));
    ok('buildRosterNote: <2 isim → null, ≥2 → isimler + "address by name"');
} catch (e) {
    fail('roster note', e.message);
}

try {
    assert.equal(buildTurnResponseInstruction({ items: [] }), null);
    assert.equal(buildTurnResponseInstruction({ items: [{ text: '   ' }] }), null);

    // Open floor → herkese doğrudan cevap
    const open = buildTurnResponseInstruction({
        floor: null,
        items: [
            { speaker: 'Ali', text: 'Fiyat ne?' },
            { speaker: null, text: 'Deneme süresi?' }
        ]
    });
    assert.ok(open.includes('Ali: Fiyat ne?'));
    assert.ok(open.includes('Deneme süresi?'));
    assert.ok(/addressing each asker by name/i.test(open));
    assert.ok(!open.toLowerCase().includes('playbook'));

    // Floor sahibi varken → katkı içeri, yeni konu "elini kaldır"a, bekleyenler listeli
    const withFloor = buildTurnResponseInstruction({
        floor: { identity: 'v_a', name: 'Ali' },
        items: [{ speaker: 'Mehmet', text: 'Peki SSO?' }],
        hands: [{ identity: 'v_c', name: 'Can' }]
    });
    assert.ok(withFloor.includes('Ali currently has the floor'));
    assert.ok(/raise their hand/i.test(withFloor));
    assert.ok(withFloor.includes('Can'));
    assert.ok(/do not switch to them yet/i.test(withFloor));
    ok('buildTurnResponseInstruction: open floor vs floor sahibi + bekleyenler');
} catch (e) {
    fail('turn response instr', e.message);
}

try {
    const roster = [
        { identity: 'visitor_a', name: 'Ali' },
        { identity: 'visitor_b', name: 'Ayşe' }
    ];
    assert.equal(resolveSpeaker(roster, 'visitor_b'), 'Ayşe');
    assert.equal(resolveSpeaker(roster, 'visitor_x'), null);
    assert.equal(resolveSpeaker(roster, null), null);
    assert.equal(resolveSpeaker([{ identity: 'visitor_a', name: '' }], 'visitor_a'), null);
    ok('resolveSpeaker: identity→isim, bilinmeyen/null → null');
} catch (e) {
    fail('resolveSpeaker', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
