/**
 * Unit test — buildSystemPrompt() layout (packages/agent/src/persona.js)
 *
 * No DB/network/live-service dependency: buildSystemPrompt is a pure function
 * of its config object. This locks in Görev #10: a language model weights the
 * start and the end of its context most heavily, so identity + what-to-do must
 * come first and every hard prohibition must sit in a single block at the very
 * end — not scattered through the middle where it used to live.
 *
 * Run: node backend_tests/unit/system-prompt-structure.mjs
 */
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../../packages/agent/src/persona.js';

let passed = 0;
let failed = 0;
function ok(label) {
    console.log(`  ✅ ${label}`);
    passed++;
}
function fail(label, reason) {
    console.error(`  ❌ ${label}`);
    if (reason) console.error(`     ${reason}`);
    failed++;
}

console.log('\n🧪 Unit — system-prompt-structure (buildSystemPrompt layout)\n');

const baseCfg = { name: 'Aylin', product: { name: 'Cyberverse', description: 'GRC platformu' }, persona: {} };
const HARD = 'Hard rules — never do any of these:';

// The NEVER/prohibition lines that must all live in the final block.
const PROHIBITIONS_ALWAYS = [
    'NEVER use markdown',
    'NEVER switch language mid-sentence',
    'NEVER mention or hint at how you work',
    'NEVER narrate that you are searching',
    'NEVER narrate your own actions, plans, or thinking',
    'Never pad',
    'Never say something you have already said'
];

try {
    const p = buildSystemPrompt(baseCfg);
    const firstLine = p.split('\n').find((l) => l.trim());
    assert.ok(firstLine.startsWith('You are Aylin,'), `first line was: ${firstLine}`);
    assert.ok(firstLine.includes('Cyberverse'));
    ok('İlk satır kimlik + ürün adı ile başlıyor');
} catch (e) {
    fail('ilk satır kimlik', e.message);
}

try {
    const p = buildSystemPrompt(baseCfg);
    assert.ok(p.includes('Your job:'), 'no "Your job:" header');
    assert.ok(p.includes(HARD), 'no hard-rules header');
    assert.ok(p.indexOf('Your job:') < p.indexOf(HARD), '"Your job:" must precede hard rules');
    ok('"Your job:" bölümü başta, "Hard rules" bölümü ondan sonra');
} catch (e) {
    fail('bölüm sırası', e.message);
}

try {
    const p = buildSystemPrompt(baseCfg);
    const hardIdx = p.indexOf(HARD);
    for (const phrase of PROHIBITIONS_ALWAYS) {
        assert.ok(p.includes(phrase), `missing prohibition: "${phrase}"`);
        assert.ok(p.indexOf(phrase) > hardIdx, `"${phrase}" appears BEFORE the hard-rules block`);
    }
    ok('Tüm kalıcı yasak kuralları son "Hard rules" bloğunda');
} catch (e) {
    fail('yasaklar sonda', e.message);
}

try {
    const p = buildSystemPrompt(baseCfg);
    // The hard-rules block is the last real section — nothing but its own
    // lines after the header.
    const after = p.slice(p.indexOf(HARD));
    assert.ok(!after.includes('Guardrails:'), 'Guardrails section leaked after hard rules');
    assert.ok(!after.includes('Your job:'));
    assert.ok(after.trim().length > 0);
    ok('"Hard rules" prompt\'un son bölümü');
} catch (e) {
    fail('hard rules en sonda', e.message);
}

try {
    const noPb = buildSystemPrompt(baseCfg);
    const pb = buildSystemPrompt({ ...baseCfg, playbookActive: true });
    // playbook variant: never leaks the word, still has the closing block
    assert.ok(!pb.toLowerCase().includes('playbook'));
    assert.ok(pb.includes(HARD));
    assert.ok(pb.includes('advance_step'));
    assert.ok(!noPb.includes('advance_step'));
    // The "never ask what to do next" prohibition is non-playbook only, and
    // when present it must be in the hard-rules block.
    assert.ok(noPb.includes('NEVER ask the customer what to do next'));
    assert.ok(noPb.indexOf('NEVER ask the customer what to do next') > noPb.indexOf(HARD));
    assert.ok(!pb.includes('NEVER ask the customer what to do next'));
    ok('playbook true/false varyantları tutarlı, yasaklar yine sonda');
} catch (e) {
    fail('playbook varyant', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
