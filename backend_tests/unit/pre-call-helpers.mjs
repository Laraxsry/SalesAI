/**
 * Unit test — pre-call survey pure helpers (packages/agent/src/pre-call.js)
 *
 * No DB/network/LLM. Görev #7 — the survey → generated tour plan pipeline.
 * The safety-critical bit is `sanitizeGeneratedPlan` enforcing
 * `agent.screenModes`: a voice-only agent's plan must carry NO page URLs.
 *
 * Run: node backend_tests/unit/pre-call-helpers.mjs
 */
import assert from 'node:assert/strict';
import {
    clampSurveyAnswers,
    surveyShouldStop,
    sanitizeGeneratedPlan,
    planToPlaybookNodes
} from '../../packages/agent/src/pre-call.js';

let passed = 0;
let failed = 0;
const ok = (l) => {
    console.log(`  ✅ ${l}`);
    passed++;
};
const fail = (l, r) => {
    console.error(`  ❌ ${l}`);
    if (r) console.error(`     ${r}`);
    failed++;
};

console.log('\n🧪 Unit — pre-call-helpers\n');

try {
    const cleaned = clampSurveyAnswers([
        { q: 'a', a: ' Yönetici ' },
        { q: 'b', a: '' }, // empty answer dropped
        { q: 3, a: 4 }, // coerced to strings ('' → dropped)
        { q: 'c', a: 'x'.repeat(5000) }
    ]);
    assert.equal(cleaned.length, 2);
    assert.equal(cleaned[0].a, 'Yönetici');
    assert.ok(cleaned[1].a.length <= 1000);
    ok('clampSurveyAnswers: trim, boş cevap eler, uzunluk sınırı');
} catch (e) {
    fail('clampSurveyAnswers', e.message);
}

try {
    assert.equal(surveyShouldStop([]), false);
    assert.equal(surveyShouldStop(Array.from({ length: 6 }, (_, i) => ({ q: 'q', a: `a${i}` }))), false);
    assert.equal(surveyShouldStop(Array.from({ length: 7 }, (_, i) => ({ q: 'q', a: `a${i}` }))), true);
    ok('surveyShouldStop: 7. cevapta sert durur');
} catch (e) {
    fail('surveyShouldStop', e.message);
}

const rawPlan = {
    steps: [
        { url: 'https://x.com/pricing', coverage: 'fiyat', narration: 'Fiyatlandırma şöyle.' },
        { url: 'https://x.com/GHOST', coverage: 'olmayan sayfa', narration: 'n2' },
        { coverage: 'sadece anlatım', narration: 'Bu adımda sayfa yok.' },
        { coverage: '', narration: '' } // empty step dropped
    ]
};

try {
    // voice-only agent → hiçbir adımda url yok
    const p = sanitizeGeneratedPlan(rawPlan, {
        siteMapUrls: ['https://x.com/pricing'],
        canShowScreen: false
    });
    assert.equal(p.screenMode, 'voice-only');
    assert.equal(p.steps.length, 3);
    assert.ok(p.steps.every((s) => s.url === null));
    ok('sanitizeGeneratedPlan: voice-only → tüm URL\'ler silinir');
} catch (e) {
    fail('sanitize voice-only', e.message);
}

try {
    // guided-tour agent → sadece site haritasındaki URL kalır
    const p = sanitizeGeneratedPlan(rawPlan, {
        siteMapUrls: new Set(['https://x.com/pricing']),
        canShowScreen: true
    });
    assert.equal(p.screenMode, 'guided-tour');
    assert.equal(p.steps.length, 3);
    assert.equal(p.steps[0].url, 'https://x.com/pricing');
    assert.equal(p.steps[1].url, null, 'site haritasında olmayan URL düşer, adım anlatım-only kalır');
    assert.equal(p.steps[2].url, null);
    ok('sanitizeGeneratedPlan: guided-tour → yalnız site haritası URL\'leri');
} catch (e) {
    fail('sanitize guided-tour', e.message);
}

try {
    assert.equal(sanitizeGeneratedPlan({ steps: [] }, { canShowScreen: true }), null);
    assert.equal(sanitizeGeneratedPlan(null, {}), null);
    ok('sanitizeGeneratedPlan: boş/geçersiz plan → null');
} catch (e) {
    fail('sanitize empty', e.message);
}

try {
    const p = sanitizeGeneratedPlan(rawPlan, { siteMapUrls: ['https://x.com/pricing'], canShowScreen: true });
    const nodes = planToPlaybookNodes(p);
    assert.equal(nodes.length, 3);
    assert.deepEqual(
        nodes.map((n) => n.order),
        [0, 1, 2]
    );
    assert.equal(nodes[0].url, 'https://x.com/pricing');
    assert.equal(nodes[0].narration, 'Fiyatlandırma şöyle.');
    assert.equal(nodes[0].mode, 'important');
    assert.equal(nodes[1].url, null);
    ok('planToPlaybookNodes: order, url null geçişi, narration + mode taşınır');
} catch (e) {
    fail('planToPlaybookNodes', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
