/**
 * Unit test — applyMeetingMessage / buildMeetingStatusText
 * (apps/visitor/src/meeting-status.js)
 *
 * No browser/React dependency: pure reducer + string builder for the Görev #11
 * group-meeting status line shown under the AI orb.
 *
 * Run: node backend_tests/unit/meeting-status.mjs
 */
import assert from 'node:assert/strict';
import { applyMeetingMessage, buildMeetingStatusText } from '../../apps/visitor/src/meeting-status.js';

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

console.log('\n🧪 Unit — meeting-status\n');

try {
    // alakasız / bozuk mesaj → prev korunur
    assert.equal(applyMeetingMessage(null, 'not json'), null);
    assert.equal(applyMeetingMessage({ x: 1 }, JSON.stringify({ type: 'chat' })).x, 1);

    const state = applyMeetingMessage(
        null,
        JSON.stringify({
            type: 'salesai:meeting',
            phase: 'live',
            visitorCount: 3,
            maxParticipants: 10,
            floor: { identity: 'v_a', name: 'Ali' },
            hands: [{ identity: 'v_b', name: 'Ayşe' }, { identity: 'bad' }, null]
        })
    );
    assert.equal(state.phase, 'live');
    assert.equal(state.visitorCount, 3);
    assert.deepEqual(state.floor, { identity: 'v_a', name: 'Ali' });
    assert.equal(state.hands.length, 2);
    ok('applyMeetingMessage: yalnız salesai:meeting işlenir, geçersiz el kayıtları elenir');
} catch (e) {
    fail('applyMeetingMessage', e.message);
}

try {
    assert.equal(buildMeetingStatusText(null), '');
    assert.equal(
        buildMeetingStatusText({ phase: 'waiting', visitorCount: 3, hands: [] }),
        '3 kişi katıldı — sunum başlamak için bekleniyor'
    );
    // live + open floor → '' (normal state label gösterilsin)
    assert.equal(buildMeetingStatusText({ phase: 'live', floor: null, hands: [] }), '');
    // live + floor + hands, "siz" işaretleme
    const text = buildMeetingStatusText(
        {
            phase: 'live',
            floor: { identity: 'v_a', name: 'Ali' },
            hands: [
                { identity: 'v_b', name: 'Ayşe' },
                { identity: 'v_self', name: 'Mehmet' }
            ]
        },
        'v_self'
    );
    assert.ok(text.includes('Ali ile konuşuluyor'));
    assert.ok(text.includes('Sırada: Ayşe, siz'));
    ok('buildMeetingStatusText: waiting / open-floor / floor + sıra (+ "siz")');
} catch (e) {
    fail('buildMeetingStatusText', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
