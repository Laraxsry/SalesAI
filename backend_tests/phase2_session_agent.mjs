/**
 * Phase 2 — LiveKit Dispatch Config Testi
 *
 * Test Kapsamı:
 *  1. AgentDispatchClient sınıfının import edilebilir olduğunu doğrula
 *  2. dispatchAgent() fonksiyonunun @repo/livekit'ten export edildiğini doğrula
 *  3. agent.js WorkerOptions'ında agentName'in bulunduğunu doğrula (kaynak kodu parse)
 *  4. sessions.js'de dispatchAgent çağrısının bulunduğunu doğrula (kaynak kodu parse)
 *  5. LiveKit server'a bağlanarak gerçek dispatch API'sini test et (infra çalışıyorsa)
 */

import '@repo/config-env/load';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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

async function run() {
    console.log('\n🚀 Phase 2 — LiveKit Dispatch Config Testi Başlıyor...\n');

    // ── Test 1: @repo/livekit'te dispatchAgent export'u var mı? ──────────────
    console.log('📌 1. @repo/livekit → dispatchAgent export kontrolü');
    try {
        const { dispatchAgent, createAccessToken, livekitUrl } = await import('@repo/livekit');
        if (typeof dispatchAgent === 'function') ok('dispatchAgent fonksiyon olarak export edilmiş');
        else fail('dispatchAgent', 'export var ama fonksiyon değil');

        if (typeof createAccessToken === 'function') ok('createAccessToken hâlâ mevcut (regression yok)');
        else fail('createAccessToken kaybolmuş!');

        if (typeof livekitUrl === 'function') ok('livekitUrl hâlâ mevcut (regression yok)');
        else fail('livekitUrl kaybolmuş!');
    } catch (e) {
        fail('@repo/livekit import başarısız', e.message);
    }

    // ── Test 2: agent.js kaynak kodunda agentName var mı? ────────────────────
    console.log('\n📌 2. agent-worker/src/agent.js → agentName kontrolü');
    try {
        const agentSrc = readFileSync(join(ROOT, 'apps/agent-worker/src/agent.js'), 'utf-8');
        if (agentSrc.includes('agentName')) ok("WorkerOptions içinde agentName bulundu");
        else fail("agentName WorkerOptions'ta yok!");

        if (agentSrc.includes('salesai-agent')) ok("agentName değeri 'salesai-agent' ile eşleşiyor");
        else fail("agentName değeri 'salesai-agent' değil!");

        if (agentSrc.includes('LIVEKIT_AGENT_NAME')) ok('LIVEKIT_AGENT_NAME env var override destekleniyor');
        else fail('LIVEKIT_AGENT_NAME env override yok');
    } catch (e) {
        fail('agent.js okunamadı', e.message);
    }

    // ── Test 3: sessions.js'de dispatchAgent çağrısı var mı? ─────────────────
    console.log('\n📌 3. routes/sessions.js → dispatchAgent çağrısı kontrolü');
    try {
        const sessionsSrc = readFileSync(join(ROOT, 'apps/api/src/routes/sessions.js'), 'utf-8');
        if (sessionsSrc.includes('dispatchAgent')) ok("dispatchAgent import'u sessions.js'de bulundu");
        else fail("dispatchAgent sessions.js'de yok!");

        if (sessionsSrc.includes('await dispatchAgent')) ok('dispatchAgent session oluşturulunca await ile çağrılıyor');
        else fail('await dispatchAgent çağrısı yok!');

        if (sessionsSrc.includes('Non-fatal') || sessionsSrc.includes('catch')) ok('dispatch hatası non-fatal şekilde handle ediliyor');
        else fail('dispatch hatası handle edilmiyor — visitor bloklanabilir!');
    } catch (e) {
        fail('sessions.js okunamadı', e.message);
    }

    // ── Test 4: AgentDispatchClient gerçek bağlantı testi (infra gerekli) ────
    console.log('\n📌 4. AgentDispatchClient → LiveKit sunucusuna bağlantı testi');
    try {
        const { AgentDispatchClient } = await import('livekit-server-sdk');

        const wsUrl  = process.env.LIVEKIT_URL        || 'ws://localhost:7880';
        const apiKey = process.env.LIVEKIT_API_KEY    || 'devkey';
        const secret = process.env.LIVEKIT_API_SECRET || 'secret';

        const httpUrl = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://');
        const client = new AgentDispatchClient(httpUrl, apiKey, secret);

        const testRoom = `dispatch_test_${Date.now()}`;
        const dispatches = await client.listDispatch(testRoom);
        ok(`AgentDispatchClient bağlandı (oda: ${testRoom}, dispatch sayısı: ${dispatches.length})`);
    } catch (e) {
        if (e.message?.includes('ECONNREFUSED') || e.message?.includes('fetch') || e.message?.includes('connect')) {
            console.log('  ⚠️  LiveKit sunucusu kapalı — bağlantı testi atlandı (beklenen, infra down)');
        } else {
            fail('AgentDispatchClient bağlantı hatası', e.message);
        }
    }

    // ── Özet ──────────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(55));
    console.log(`Sonuç: ${passed} geçti, ${failed} başarısız`);
    if (failed === 0) {
        console.log('🎉 Phase 2 Dispatch Config testleri tamamlandı!\n');
        process.exit(0);
    } else {
        console.error('💥 Bazı testler başarısız!\n');
        process.exit(1);
    }
}

run().catch(e => { console.error('Test çöktü:', e); process.exit(1); });
