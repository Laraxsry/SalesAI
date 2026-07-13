/**
 * Phase 1 — DOCX Desteği + Socket.IO Emit Testi
 *
 * Kapsam:
 *  1. mammoth'un import edildiğini doğrula
 *  2. ingest-source.js'de docx case'inin varlığını doğrula (kaynak parse)
 *  3. publishEvent() fonksiyonunun @repo/realtime'dan export edildiğini doğrula
 *  4. RT_EVENTS sabitlerinin doğru tanımlı olduğunu doğrula
 *  5. API üzerinden Redis'e gerçek bir publish test et
 */

import '@repo/config-env/load';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✅ ${label}`); passed++; }
function fail(label, reason) {
    console.error(`  ❌ ${label}`);
    if (reason) console.error(`     ${reason}`);
    failed++;
}

async function run() {
    console.log('\n🚀 Phase 1 — DOCX + Socket.IO Emit Testi Başlıyor...\n');

    // ── Test 1: ingest-source.js mammoth kullanıyor mu? ──────────────────────
    console.log('📌 1. ingest-source.js → mammoth kontrolü');
    try {
        const src = readFileSync(
            join(ROOT, 'apps/worker-ingestion/src/handlers/ingest-source.js'), 'utf-8'
        );
        if (src.includes("import mammoth")) ok("mammoth import'u bulundu");
        else fail("mammoth import'u yok!");

        if (src.includes("mammoth.extractRawText")) ok("mammoth.extractRawText() çağrısı bulundu");
        else fail("mammoth.extractRawText() çağrısı yok!");

        if (src.includes("ext === 'docx'")) ok("docx uzantı kontrolü bulundu");
        else fail("docx uzantı kontrolü yok!");
    } catch (e) {
        fail('ingest-source.js okunamadı', e.message);
    }

    // ── Test 2: ingest-source.js emit çağrıları var mı? ──────────────────────
    console.log('\n📌 2. ingest-source.js → emitProgress çağrıları kontrolü');
    try {
        const src = readFileSync(
            join(ROOT, 'apps/worker-ingestion/src/handlers/ingest-source.js'), 'utf-8'
        );
        const emitCount = (src.match(/emitProgress/g) || []).length;
        if (emitCount >= 5) ok(`emitProgress ${emitCount} yerde çağrılıyor (min 5 bekleniyor)`);
        else fail(`emitProgress çağrısı çok az: ${emitCount}`);

        if (src.includes('INGESTION_READY')) ok('INGESTION_READY event tamamlanınca yayınlanıyor');
        else fail('INGESTION_READY yok!');

        if (src.includes('publishEvent')) ok('publishEvent import edilmiş ve kullanılıyor');
        else fail('publishEvent kullanılmıyor!');
    } catch (e) {
        fail('ingest-source.js okunamadı', e.message);
    }

    // ── Test 3: @repo/realtime publishEvent export kontrolü ──────────────────
    console.log('\n📌 3. @repo/realtime → publishEvent + RT_EVENTS kontrolü');
    try {
        const { publishEvent, RT_EVENTS } = await import('@repo/realtime');

        if (typeof publishEvent === 'function') ok('publishEvent fonksiyon olarak export edilmiş');
        else fail('publishEvent export yok!');

        const requiredEvents = ['INGESTION_PROGRESS', 'INGESTION_READY', 'SESSION_TRANSCRIPT'];
        for (const ev of requiredEvents) {
            if (RT_EVENTS[ev]) ok(`RT_EVENTS.${ev} = '${RT_EVENTS[ev]}'`);
            else fail(`RT_EVENTS.${ev} tanımlı değil!`);
        }
    } catch (e) {
        fail('@repo/realtime import başarısız', e.message);
    }

    // ── Test 4: API main.js Redis subscriber var mı? ─────────────────────────
    console.log('\n📌 4. apps/api/src/main.js → Redis rt:emit subscriber kontrolü');
    try {
        const src = readFileSync(join(ROOT, 'apps/api/src/main.js'), 'utf-8');
        if (src.includes("subscribe('rt:emit')") || src.includes('subscribe("rt:emit")'))
            ok("Redis 'rt:emit' kanalına subscribe bulundu");
        else fail("Redis rt:emit subscribe yok!");

        if (src.includes("io.emit(event")) ok("io.emit(event, payload) ile Socket.IO'ya iletiliyor");
        else fail("io.emit iletimi yok!");
    } catch (e) {
        fail('main.js okunamadı', e.message);
    }

    // ── Test 5: Gerçek Redis publish testi ───────────────────────────────────
    console.log('\n📌 5. Redis → publishEvent() gerçek bağlantı testi');
    try {
        const { publishEvent, RT_EVENTS } = await import('@repo/realtime');
        await publishEvent(RT_EVENTS.INGESTION_PROGRESS, {
            sourceId: 'test_source_123',
            stage: 'Test aşaması',
            pct: 50
        });
        ok('publishEvent() Redis\'e başarıyla yazdı (event: ingestion:progress)');
    } catch (e) {
        if (e.message?.includes('ECONNREFUSED') || e.message?.includes('connect')) {
            console.log('  ⚠️  Redis kapalı — gerçek publish testi atlandı (infra down)');
        } else {
            fail('publishEvent hatası', e.message);
        }
    }

    // ── Özet ─────────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(55));
    console.log(`Sonuç: ${passed} geçti, ${failed} başarısız`);
    if (failed === 0) {
        console.log('🎉 Phase 1 DOCX + Emit testleri tamamlandı!\n');
        process.exit(0);
    } else {
        console.error('💥 Bazı testler başarısız!\n');
        process.exit(1);
    }
}

run().catch(e => { console.error('Test çöktü:', e); process.exit(1); });
