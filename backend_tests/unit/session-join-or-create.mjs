/**
 * Unit test — pickSessionForJoin() (apps/api/src/services/share-link-sessions.js)
 *
 * No DB/network dependency: the function takes already-fetched candidate
 * sessions and returns a pure 'join'/'create' decision. This is the core of
 * Görev #1 multi-participant routing — a second visitor for the same agent
 * lands in the SAME room instead of minting a fresh one.
 *
 * Run: node backend_tests/unit/session-join-or-create.mjs
 */
import assert from 'node:assert/strict';
import { pickSessionForJoin } from '../../apps/api/src/services/share-link-sessions.js';

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

console.log('\n🧪 Unit — session-join-or-create (pickSessionForJoin)\n');

const sess = (over = {}) => ({
    _id: 'x',
    status: 'waiting',
    participants: [{ identity: 'visitor_1' }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over
});

try {
    assert.deepEqual(pickSessionForJoin({ candidateSessions: [sess()], maxParticipants: 1 }), {
        action: 'create'
    });
    assert.deepEqual(pickSessionForJoin({ candidateSessions: [sess()], maxParticipants: undefined }), {
        action: 'create'
    });
    ok('maxParticipants <= 1 → daima create');
} catch (e) {
    fail('single', e.message);
}

try {
    assert.deepEqual(pickSessionForJoin({ candidateSessions: [], maxParticipants: 3 }), {
        action: 'create'
    });
    ok('aday yok → create');
} catch (e) {
    fail('no candidates', e.message);
}

try {
    const s = sess();
    const r = pickSessionForJoin({ candidateSessions: [s], maxParticipants: 3 });
    assert.equal(r.action, 'join');
    assert.equal(r.session, s);
    ok('1/3 dolu waiting oda → join');
} catch (e) {
    fail('join partial', e.message);
}

try {
    const full = sess({ participants: [{ identity: 'a' }, { identity: 'b' }, { identity: 'c' }] });
    assert.equal(pickSessionForJoin({ candidateSessions: [full], maxParticipants: 3 }).action, 'full');
    ok('dolu oda (3/3) + başka aktif yok → full (reddet)');
} catch (e) {
    fail('full', e.message);
}

try {
    // leftAt'li katılımcılar koltuk saymaz
    const s = sess({
        participants: [{ identity: 'a', leftAt: new Date() }, { identity: 'b' }, { identity: 'c' }]
    });
    assert.equal(pickSessionForJoin({ candidateSessions: [s], maxParticipants: 3 }).action, 'join');
    ok('ayrılmış katılımcı koltuk açar → join');
} catch (e) {
    fail('leftAt', e.message);
}

try {
    for (const status of ['ended', 'failed']) {
        assert.equal(
            pickSessionForJoin({ candidateSessions: [sess({ status })], maxParticipants: 3 }).action,
            'create'
        );
    }
    ok('ended/failed oturumlara join edilmez');
} catch (e) {
    fail('closed', e.message);
}

try {
    const older = sess({ _id: 'older', createdAt: new Date('2026-01-01T00:00:00Z') });
    const newer = sess({ _id: 'newer', createdAt: new Date('2026-06-01T00:00:00Z') });
    const r = pickSessionForJoin({ candidateSessions: [newer, older], maxParticipants: 3 });
    assert.equal(r.session._id, 'older');
    ok('birden fazla uygun oda → en eskisine join');
} catch (e) {
    fail('oldest', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
