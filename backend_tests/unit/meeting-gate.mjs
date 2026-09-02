/**
 * Unit test — classifyStartIntent / shouldStartMeeting / buildWaitingRoomPrompt
 * (packages/agent/src/meeting.js)
 *
 * No DB/network dependency: pure decision logic for the Görev #1 multi-
 * participant waiting-room flow.
 *
 * Run: node backend_tests/unit/meeting-gate.mjs
 */
import assert from 'node:assert/strict';
import {
    classifyStartIntent,
    shouldStartMeeting,
    buildWaitingRoomPrompt
} from '../../packages/agent/src/meeting.js';

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

console.log('\n🧪 Unit — meeting-gate\n');

try {
    for (const t of ['Başlayalım', 'evet başlayabiliriz', 'Hazırız, devam', 'yes, go ahead', "let's go"]) {
        assert.equal(classifyStartIntent(t), 'start', `"${t}" → start bekleniyordu`);
    }
    ok('başlama niyeti (TR/EN) → start');
} catch (e) {
    fail('start intent', e.message);
}

try {
    for (const t of [
        'Biraz daha bekleyelim',
        'hayır, birkaç kişi daha katılacak',
        'henüz değil',
        'wait a few more',
        'not yet, someone else is coming'
    ]) {
        assert.equal(classifyStartIntent(t), 'wait', `"${t}" → wait bekleniyordu`);
    }
    ok('bekleme niyeti (TR/EN) → wait');
} catch (e) {
    fail('wait intent', e.message);
}

try {
    for (const t of ['', '   ', 'merhaba', 'ekran görünmüyor', 'fiyatları anlat']) {
        assert.equal(classifyStartIntent(t), 'unclear', `"${t}" → unclear bekleniyordu`);
    }
    ok('alakasız / boş → unclear');
} catch (e) {
    fail('unclear intent', e.message);
}

try {
    // oda dolu
    assert.equal(
        shouldStartMeeting({ visitorCount: 5, maxParticipants: 5, waitedMs: 0, maxWaitMs: 6e5 }),
        true
    );
    // birisi "başla" dedi
    assert.equal(
        shouldStartMeeting({
            visitorCount: 2,
            maxParticipants: 5,
            waitedMs: 1000,
            maxWaitMs: 6e5,
            lastIntent: 'start'
        }),
        true
    );
    // max bekleme aşıldı
    assert.equal(
        shouldStartMeeting({ visitorCount: 2, maxParticipants: 5, waitedMs: 6e5, maxWaitMs: 6e5 }),
        true
    );
    // henüz erken, kimse başla demedi
    assert.equal(
        shouldStartMeeting({
            visitorCount: 2,
            maxParticipants: 5,
            waitedMs: 1000,
            maxWaitMs: 6e5,
            lastIntent: 'wait'
        }),
        false
    );
    // odada kimse yok
    assert.equal(
        shouldStartMeeting({ visitorCount: 0, maxParticipants: 5, waitedMs: 9e9, maxWaitMs: 6e5 }),
        false
    );
    ok('shouldStartMeeting tüm dallar');
} catch (e) {
    fail('shouldStartMeeting', e.message);
}

try {
    const p = buildWaitingRoomPrompt({ visitorCount: 3, maxParticipants: 10 });
    assert.ok(p.includes('3'));
    assert.ok(p.includes('10'));
    assert.ok(/do not call any tools/i.test(p));
    assert.ok(!p.toLowerCase().includes('playbook'));
    ok('buildWaitingRoomPrompt sayıları + "no tools" içeriyor');
} catch (e) {
    fail('waiting prompt', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
