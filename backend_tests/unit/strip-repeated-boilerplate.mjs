/**
 * Unit test — stripRepeatedBoilerplate()
 * (apps/worker-ingestion/src/extractors/url.js)
 *
 * No DB/network/live-service dependency: pure line-diffing logic. This is
 * what removes sidebar-nav/header chrome that a crawled dashboard repeats on
 * every single page, before that text ever reaches chunking/embedding.
 *
 * Run: node backend_tests/unit/strip-repeated-boilerplate.mjs
 */
import assert from 'node:assert/strict';
import { stripRepeatedBoilerplate } from '../../apps/worker-ingestion/src/extractors/url.js';

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

console.log('\n🧪 Unit — stripRepeatedBoilerplate()\n');

// A line repeated on all pages (nav chrome) is dropped; page-unique lines survive.
try {
    const pages = [
        { url: '/a', text: 'NAV\nHEADER\nPage A unique content' },
        { url: '/b', text: 'NAV\nHEADER\nPage B unique content' },
        { url: '/c', text: 'NAV\nHEADER\nPage C unique content' }
    ];
    const result = stripRepeatedBoilerplate(pages);
    assert.equal(result[0].text, 'Page A unique content');
    assert.equal(result[1].text, 'Page B unique content');
    assert.equal(result[2].text, 'Page C unique content');
    ok('3 sayfada tekrarlayan NAV/HEADER satırları çıkarılıyor, sayfaya özgü içerik kalıyor');
} catch (e) {
    fail('tekrarlayan satır çıkarma', e.message);
}

// Fewer than BOILERPLATE_MIN_PAGES (3) pages: nothing stripped, even if identical —
// not enough pages to trust "repeats across most pages" as a real signal.
try {
    const pages = [
        { url: '/a', text: 'NAV\nPage A' },
        { url: '/b', text: 'NAV\nPage B' }
    ];
    const result = stripRepeatedBoilerplate(pages);
    assert.equal(result[0].text, 'NAV Page A');
    assert.equal(result[1].text, 'NAV Page B');
    ok('2 sayfa (< min eşik) → hiçbir şey çıkarılmıyor, sadece satırlar birleştiriliyor');
} catch (e) {
    fail('minimum sayfa eşiği', e.message);
}

// A line shared by only a minority of pages (below the 60% default threshold)
// is real content, not chrome — must survive.
try {
    const pages = [
        { url: '/a', text: 'Shared by two\nPage A only' },
        { url: '/b', text: 'Shared by two\nPage B only' },
        { url: '/c', text: 'Page C only' },
        { url: '/d', text: 'Page D only' },
        { url: '/e', text: 'Page E only' }
    ];
    const result = stripRepeatedBoilerplate(pages);
    assert.ok(result[0].text.includes('Shared by two'), 'azınlıkta paylaşılan satır silinmemeli');
    ok('Eşiğin altında (2/5 = %40 < %60) paylaşılan satır siliniyor');
} catch (e) {
    fail('eşik altı satır korunmalı', e.message);
}

// Every page's text still ends up flattened to a single \n-free line either way.
try {
    const pages = [
        { url: '/a', text: 'L1\nL2' },
        { url: '/b', text: 'L1\nL3' },
        { url: '/c', text: 'L1\nL4' }
    ];
    const result = stripRepeatedBoilerplate(pages);
    for (const p of result) assert.ok(!p.text.includes('\n'), `${p.url} metni hâlâ çok satırlı`);
    ok('Sonuç her zaman tek satıra düzleştiriliyor (chunking için)');
} catch (e) {
    fail('düzleştirme', e.message);
}

console.log(`\n${passed} geçti, ${failed} başarısız.\n`);
if (failed > 0) process.exit(1);
