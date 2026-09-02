/**
 * Unit test — pickActiveSpeaker / chooseAttribution
 * (apps/agent-worker/src/active-speaker.js)
 *
 * No DB/network dependency. Görev #11 follow-up: the agent follows the active
 * speaker but must ignore a visitor whose mic is off, so a "unmute → talk →
 * mute" blip can't leave it attributing to (or listening to) a muted mic.
 *
 * Run: node backend_tests/unit/active-speaker.mjs
 */
import assert from 'node:assert/strict';
import { pickActiveSpeaker, chooseAttribution } from '../../apps/agent-worker/src/active-speaker.js';

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

console.log('\n🧪 Unit — active-speaker\n');

try {
    assert.equal(
        pickActiveSpeaker([
            { identity: 'agent-x', micOn: true },
            { identity: 'visitor_b', micOn: false },
            { identity: 'visitor_c', micOn: true }
        ]),
        'visitor_c'
    );
    assert.equal(pickActiveSpeaker([{ identity: 'visitor_b', micOn: false }]), null);
    assert.equal(pickActiveSpeaker([]), null);
    assert.equal(pickActiveSpeaker(null), null);
    assert.equal(pickActiveSpeaker([{ identity: 'agent-x', micOn: true }]), null);
    ok('pickActiveSpeaker: sadece mikrofonu açık visitor_, yoksa null');
} catch (e) {
    fail('pickActiveSpeaker', e.message);
}

try {
    // SDK'nın speakerId'si varsa o esastır — susmuş olsa bile o sözler ondan
    assert.equal(
        chooseAttribution({ eventSpeakerId: 'visitor_a', fallbackIdentity: 'visitor_b', micOnFor: () => false }),
        'visitor_a'
    );
    // speakerId yok → fallback ancak mikrofonu HÂLÂ açıksa
    assert.equal(
        chooseAttribution({
            eventSpeakerId: null,
            fallbackIdentity: 'visitor_b',
            micOnFor: (id) => id === 'visitor_b'
        }),
        'visitor_b'
    );
    // speakerId yok + fallback susmuş → null (odaya konuş)
    assert.equal(
        chooseAttribution({ eventSpeakerId: null, fallbackIdentity: 'visitor_b', micOnFor: () => false }),
        null
    );
    // hiçbir bilgi yok → null
    assert.equal(chooseAttribution({ eventSpeakerId: null, fallbackIdentity: null }), null);
    ok('chooseAttribution: speakerId öncelikli, fallback yalnız mic açıkken, yoksa null');
} catch (e) {
    fail('chooseAttribution', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
