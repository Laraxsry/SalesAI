/**
 * Unit test — buildParticipantRows() (apps/visitor/src/participant-rows.js)
 *
 * No browser/React dependency: pure derivation of the participants-panel rows
 * from raw LiveKit room state. Görev #11 UI.
 *
 * Run: node backend_tests/unit/participant-rows.mjs
 */
import assert from 'node:assert/strict';
import { buildParticipantRows, shouldShowPanel } from '../../apps/visitor/src/participant-rows.js';

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

console.log('\n🧪 Unit — participant-rows\n');

const participants = [
    { identity: 'visitor_a', name: 'Ali', isLocal: true },
    { identity: 'visitor_b', name: 'Ayşe' },
    { identity: 'visitor_c', name: '' },
    { identity: 'agent-xyz', name: 'agent' },
    { identity: 'tavus-avatar-agent', name: 'avatar' }
];

try {
    const { humans, humanCount, agent } = buildParticipantRows({
        participants,
        speakingIdentities: new Set(['visitor_b']),
        micByIdentity: new Map([
            ['visitor_a', true],
            ['visitor_b', true],
            ['visitor_c', false]
        ]),
        agentState: 'speaking'
    });
    assert.equal(humanCount, 3, 'agent + avatar filtrelenmeli');
    assert.deepEqual(
        humans.map((h) => h.identity),
        ['visitor_b', 'visitor_a', 'visitor_c'],
        'konuşan en üste'
    );
    assert.equal(humans.find((h) => h.isLocal).name, 'Siz');
    assert.equal(humans.find((h) => h.identity === 'visitor_c').name, 'Ziyaretçi');
    assert.equal(agent.speaking, true);
    ok('agent/avatar filtreli, konuşan üstte, isim fallback, local → "Siz"');
} catch (e) {
    fail('base', e.message);
}

try {
    // mikrofonu kapalıyken "speaking" gelse bile ring yanmaz
    const { humans } = buildParticipantRows({
        participants: [{ identity: 'visitor_b', name: 'Ayşe' }],
        speakingIdentities: new Set(['visitor_b']),
        micByIdentity: new Map([['visitor_b', false]])
    });
    assert.equal(humans[0].micOn, false);
    assert.equal(humans[0].speaking, false, 'mic kapalıyken speaking=false');
    ok('mikrofon kapalıyken "speaking" bayrağı sönük');
} catch (e) {
    fail('muted-speaking', e.message);
}

try {
    const { humanCount } = buildParticipantRows({ participants: [], agentState: 'idle' });
    assert.equal(humanCount, 0);
    // plain object micByIdentity da kabul
    const r = buildParticipantRows({
        participants: [{ identity: 'visitor_x', name: 'X' }],
        micByIdentity: { visitor_x: true }
    });
    assert.equal(r.humans[0].micOn, true);
    ok('boş liste + plain-object micByIdentity');
} catch (e) {
    fail('edge', e.message);
}

try {
    // group-capable session → panel görünür (tek kişi test etse bile)
    assert.equal(shouldShowPanel({ humanCount: 1, maxParticipants: 5 }), true);
    // birebir agent (maxParticipants 1 / undefined) + tek kişi → gizli
    assert.equal(shouldShowPanel({ humanCount: 1, maxParticipants: 1 }), false);
    assert.equal(shouldShowPanel({ humanCount: 1 }), false);
    // maxParticipants gelmese bile 2+ insan varsa görünür
    assert.equal(shouldShowPanel({ humanCount: 2 }), true);
    assert.equal(shouldShowPanel({}), false);
    ok('shouldShowPanel: grup-uyumlu VEYA 2+ insan → görünür');
} catch (e) {
    fail('shouldShowPanel', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
