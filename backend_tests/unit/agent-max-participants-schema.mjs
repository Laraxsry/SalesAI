/**
 * Unit test — AgentConfigInput / AgentUpdateInput `maxParticipants`
 * (packages/contracts/src/index.js)
 *
 * No DB/network dependency: pure Zod parsing. Görev #1 — the seller picks how
 * many visitors an agent presents to at once when creating the agent; 1 is the
 * default and preserves the original single-visitor behavior.
 *
 * Run: node backend_tests/unit/agent-max-participants-schema.mjs
 */
import assert from 'node:assert/strict';
import { AgentConfigInput, AgentUpdateInput, MAX_ROOM_PARTICIPANTS } from '../../packages/contracts/src/index.js';

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

console.log('\n🧪 Unit — agent-max-participants-schema\n');

const base = { productId: 'p1', name: 'Aylin' };

try {
    const parsed = AgentConfigInput.parse({ ...base });
    assert.equal(parsed.maxParticipants, 1);
    ok('AgentConfigInput: alan verilmezse default 1');
} catch (e) {
    fail('default', e.message);
}

try {
    assert.equal(AgentConfigInput.parse({ ...base, maxParticipants: 8 }).maxParticipants, 8);
    // string de kabul (form input'ları string gönderir) — coerce
    assert.equal(AgentConfigInput.parse({ ...base, maxParticipants: '5' }).maxParticipants, 5);
    ok('geçerli değer (number + string) kabul, coerce ediliyor');
} catch (e) {
    fail('valid', e.message);
}

try {
    assert.throws(() => AgentConfigInput.parse({ ...base, maxParticipants: 0 }));
    assert.throws(() => AgentConfigInput.parse({ ...base, maxParticipants: -3 }));
    assert.throws(() => AgentConfigInput.parse({ ...base, maxParticipants: 2.5 }));
    assert.throws(() => AgentConfigInput.parse({ ...base, maxParticipants: MAX_ROOM_PARTICIPANTS + 1 }));
    ok('0 / negatif / ondalık / tavan üstü reddediliyor');
} catch (e) {
    fail('invalid', e.message);
}

try {
    // update: opsiyonel, verilmezse hiç yok
    const u = AgentUpdateInput.parse({ name: 'Yeni' });
    assert.ok(!('maxParticipants' in u));
    assert.equal(AgentUpdateInput.parse({ maxParticipants: 4 }).maxParticipants, 4);
    assert.throws(() => AgentUpdateInput.parse({ maxParticipants: 0 }));
    ok('AgentUpdateInput: opsiyonel, verilince aynı sınırlar');
} catch (e) {
    fail('update', e.message);
}

try {
    // preCallSurveyEnabled — create'te default false, update'te opsiyonel
    assert.equal(AgentConfigInput.parse({ ...base }).preCallSurveyEnabled, false);
    assert.equal(AgentConfigInput.parse({ ...base, preCallSurveyEnabled: true }).preCallSurveyEnabled, true);
    assert.throws(() => AgentConfigInput.parse({ ...base, preCallSurveyEnabled: 'evet' }));
    assert.ok(!('preCallSurveyEnabled' in AgentUpdateInput.parse({ name: 'x' })));
    assert.equal(AgentUpdateInput.parse({ preCallSurveyEnabled: true }).preCallSurveyEnabled, true);
    ok('preCallSurveyEnabled: create default false, string reddedilir, update opsiyonel');
} catch (e) {
    fail('preCallSurveyEnabled', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
