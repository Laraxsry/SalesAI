/**
 * Phase 4 — Analytics & Insights: Otomatik Test Paketi
 *
 * Test Kapsamı:
 *  1. Kaynak kodu doğrulaması — analyze-session.js (gpt-4o-mini, SessionSummary persist, publishEvent)
 *  2. Kaynak kodu doğrulaması — extract-lead.js (signal tespiti: email, demo, tour, duration)
 *  3. Kaynak kodu doğrulaması — rollup-analytics.js (idempotent upsert pattern)
 *  4. Kaynak kodu doğrulaması — worker-general/main.js (analyze-session case, rollup-hourly)
 *  5. Kaynak kodu doğrulaması — RT_EVENTS (session:summary, lead:captured sabitleri)
 *  6. HTTP testi — GET /analytics/agents/:id (KPI + completion/unanswered rate)
 *  7. HTTP testi — GET /analytics/agents/:id/summary (SessionSummary listesi)
 *  8. HTTP testi — GET /analytics/products/:id/topics (topics aggregation)
 *  9. HTTP testi — GET /analytics/leads (leads listesi)
 * 10. HTTP testi — GET /analytics/knowledge-gaps (unanswered sorular)
 * 11. HTTP testi — PATCH /sessions/:id/end (session bitişi + enqueue)
 */

import '@repo/config-env/load';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import http from 'node:http';
import { connectDB, disconnectDB, Agent, Session, Message, Product, Workspace, SessionSummary, Lead } from '@repo/database';
import { registerRoutes } from '../apps/api/src/routes/index.js';
import { signTokens } from '@repo/auth';
import mongoose from 'mongoose';

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
function warn(label) {
    console.log(`  ⚠️  ${label}`);
}

async function run() {
    console.log('\n📊 Phase 4 — Analytics & Insights Testleri Başlıyor...\n');

    // ═══════════════════════════════════════════════════════════════════════════
    // BÖLÜM 1: KAYNAK KOD DOĞRULAMALARI (infra gerektirmez)
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Test 1: analyze-session.js kontrolü ───────────────────────────────────
    console.log('📌 1. analyze-session.js → Kaynak Kodu Doğrulaması');
    try {
        const src = readFileSync(
            join(ROOT, 'apps/worker-general/src/handlers/analyze-session.js'), 'utf-8'
        );

        if (src.includes('gpt-4o-mini'))
            ok('Ucuz model (gpt-4o-mini) kullanılıyor — maliyet kontrolü');
        else
            fail('gpt-4o-mini referansı yok! Pahalı model kullanılıyor olabilir.');

        if (src.includes('SessionSummary') && src.includes('findOneAndUpdate'))
            ok('SessionSummary upsert (findOneAndUpdate) var');
        else
            fail('SessionSummary persist pattern eksik!');

        if (src.includes('publishEvent'))
            ok('publishEvent() çağrısı var — Socket.IO yayını yapılıyor');
        else
            fail('publishEvent() yok — Socket.IO yayını eksik!');

        if (src.includes('session:summary'))
            ok("'session:summary' event adı doğru (03_data_model_and_api.md ile uyumlu)");
        else
            fail("'session:summary' event adı eksik!");

        if (src.includes('extractLead'))
            ok('extractLead() çağrısı var — lead extraction tetikleniyor');
        else
            fail('extractLead() çağrısı yok!');

        if (src.includes('MAX_MESSAGES_FOR_ANALYSIS'))
            ok('Transcript cap tanımlı — token maliyet kontrolü var');
        else
            fail('Transcript cap yok — sınırsız token kullanımı riski!');

    } catch (e) {
        fail('analyze-session.js okunamadı', e.message);
    }

    // ── Test 2: extract-lead.js kontrolü ──────────────────────────────────────
    console.log('\n📌 2. extract-lead.js → Lead Sinyal Tespiti Doğrulaması');
    try {
        const src = readFileSync(
            join(ROOT, 'apps/worker-general/src/handlers/extract-lead.js'), 'utf-8'
        );

        if (src.includes('EMAIL_REGEX') || src.includes('email_shared'))
            ok('Email tespiti var');
        else
            fail('Email tespiti yok!');

        if (src.includes('demo_intent') || src.includes('DEMO_KEYWORDS'))
            ok('Demo intent tespiti var');
        else
            fail('Demo intent tespiti yok!');

        if (src.includes('tour_completed'))
            ok('Tour completion sinyali var');
        else
            fail('Tour completion sinyali yok!');

        if (src.includes('long_session') || src.includes('durationMin'))
            ok('Süre tabanlı sinyal var (>2dk)');
        else
            fail('Süre sinyali yok!');

        if (src.includes("Math.min(score, 100)"))
            ok('Score 100 ile sınırlanıyor');
        else
            fail('Score üst limiti yok — 100 üzeri skor mümkün!');

        if (src.includes('publishEvent') && src.includes('lead:captured'))
            ok("'lead:captured' Socket.IO event yayını var");
        else
            fail("'lead:captured' event yayını eksik!");

        if (src.includes('upsert: true') || src.includes('findOneAndUpdate'))
            ok('Lead upsert var — duplicate önleniyor');
        else
            fail('Lead upsert yok — aynı session\'dan birden fazla lead oluşabilir!');

    } catch (e) {
        fail('extract-lead.js okunamadı', e.message);
    }

    // ── Test 3: rollup-analytics.js kontrolü ──────────────────────────────────
    console.log('\n📌 3. rollup-analytics.js → Idempotent Rollup Doğrulaması');
    try {
        const src = readFileSync(
            join(ROOT, 'apps/worker-general/src/handlers/rollup-analytics.js'), 'utf-8'
        );

        if (src.includes('upsert: true') && src.includes('updateOne'))
            ok('Idempotent upsert pattern var (updateOne + upsert: true)');
        else
            fail('Idempotent upsert yok — rollup drift riski var!');

        if (src.includes('completionRate'))
            ok('Completion rate hesaplanıyor');
        else
            fail('Completion rate eksik!');

        if (src.includes('unansweredRate'))
            ok('Unanswered rate hesaplanıyor');
        else
            fail('Unanswered rate eksik!');

        if (src.includes("scope === 'agent'") || src.includes("scope === 'product'"))
            ok('Agent ve product scope desteği var');
        else
            fail('Scope desteği eksik!');

        if (src.includes("bucket: 'hour'") || src.includes("bucket === 'hour'"))
            ok('Saatlik bucket desteği var');
        else
            fail('Saatlik bucket yok!');

    } catch (e) {
        fail('rollup-analytics.js okunamadı', e.message);
    }

    // ── Test 4: worker-general/main.js kontrolü ───────────────────────────────
    console.log('\n📌 4. worker-general/main.js → Phase 4 Job Handler Doğrulaması');
    try {
        const src = readFileSync(
            join(ROOT, 'apps/worker-general/src/main.js'), 'utf-8'
        );

        if (src.includes("case 'analyze-session'"))
            ok("'analyze-session' job case'i var");
        else
            fail("'analyze-session' job case'i eksik!");

        if (src.includes('analyzeSession'))
            ok('analyzeSession handler import edilmiş ve çağrılıyor');
        else
            fail('analyzeSession çağrısı yok!');

        if (src.includes("case 'rollup-hourly'"))
            ok("'rollup-hourly' job case'i var");
        else
            fail("'rollup-hourly' job case'i eksik!");

        if (src.includes('rollup-hourly') && src.includes("pattern: '0 * * * *'"))
            ok("Saatlik rollup cron ('0 * * * *') planlanmış");
        else
            fail('Saatlik rollup cron planlanmamış!');

        if (src.includes('./handlers/analyze-session.js'))
            ok('analyze-session.js doğru path ile import edilmiş');
        else
            fail('analyze-session.js import yolu hatalı!');

    } catch (e) {
        fail('worker-general/main.js okunamadı', e.message);
    }

    // ── Test 5: RT_EVENTS kontrolü ────────────────────────────────────────────
    console.log('\n📌 5. @repo/realtime → Phase 4 RT_EVENTS Doğrulaması');
    try {
        const { RT_EVENTS } = await import('@repo/realtime');

        if (RT_EVENTS.SESSION_SUMMARY === 'session:summary')
            ok("RT_EVENTS.SESSION_SUMMARY = 'session:summary' ✓");
        else
            fail("RT_EVENTS.SESSION_SUMMARY eksik veya hatalı!", JSON.stringify(RT_EVENTS));

        if (RT_EVENTS.LEAD_CAPTURED === 'lead:captured')
            ok("RT_EVENTS.LEAD_CAPTURED = 'lead:captured' ✓");
        else
            fail("RT_EVENTS.LEAD_CAPTURED eksik veya hatalı!", JSON.stringify(RT_EVENTS));

        // Geriye dönük uyumluluk (regression)
        if (RT_EVENTS.SESSION_TRANSCRIPT === 'session:transcript')
            ok("SESSION_TRANSCRIPT hâlâ mevcut (regression yok)");
        else
            fail("SESSION_TRANSCRIPT kaybolmuş — regression!");

    } catch (e) {
        fail('@repo/realtime import başarısız', e.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BÖLÜM 2: HTTP/DB CANLI TESTLERİ (MongoDB gerekli)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n─'.repeat(60));
    console.log('🌐 HTTP Testleri Başlıyor (MongoDB bağlantısı gerekli)...\n');

    let server;
    const testIds = {};

    try {
        await connectDB();

        const app = express();
        app.use(express.json());
        registerRoutes(app);

        server = http.createServer(app);
        const PORT = 5098;
        await new Promise((resolve) => server.listen(PORT, resolve));

        // Kimlik doğrulama token'ı
        const userId = new mongoose.Types.ObjectId();
        const tokenObj = signTokens({ sub: String(userId), email: 'test@example.com' });
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenObj.accessToken}`
        };

        // ── Test fixture'ları oluştur ──────────────────────────────────────────
        const workspace = await Workspace.create({ name: 'Test Workspace P4', slug: `tw-p4-${Date.now()}`, ownerId: userId });
        testIds.workspaceId = String(workspace._id);

        // Membership kaydı: products endpoint'leri workspace üyeliği kontrolü yapar
        const { Membership } = await import('@repo/database');
        await Membership.create({ workspaceId: workspace._id, userId, role: 'OWNER' });

        const product = await Product.create({ workspaceId: workspace._id, name: 'Test Product P4' });
        testIds.productId = String(product._id);

        const agent = await Agent.create({
            productId: product._id,
            name: 'Test Agent P4',
            status: 'active',
            persona: { tone: 'polite', goals: ['help'], guardrails: [] },
            avatarProvider: 'voice-only',
            screenModes: ['guided-tour']
        });
        testIds.agentId = String(agent._id);

        // 2 session, 1'i ended
        const session1 = await Session.create({
            agentId: agent._id,
            roomName: 'test-room-p4-1',
            status: 'ended',
            startedAt: new Date(Date.now() - 300000), // 5 dakika önce
            endedAt: new Date()
        });
        testIds.session1Id = String(session1._id);

        const session2 = await Session.create({
            agentId: agent._id,
            roomName: 'test-room-p4-2',
            status: 'ended',
            startedAt: new Date(Date.now() - 180000), // 3 dakika önce
            endedAt: new Date()
        });
        testIds.session2Id = String(session2._id);

        // Mesajlar
        await Message.create({ sessionId: session1._id, role: 'user', text: 'What is the pricing for enterprise plan?', at: new Date(Date.now() - 250000) });
        await Message.create({ sessionId: session1._id, role: 'assistant', text: 'Our enterprise plan starts at $500/month.', at: new Date(Date.now() - 240000) });
        await Message.create({ sessionId: session1._id, role: 'user', text: 'Can I book a demo please?', at: new Date(Date.now() - 230000) });

        await Message.create({ sessionId: session2._id, role: 'user', text: 'Do you support SSO integration?', at: new Date(Date.now() - 170000) });
        await Message.create({ sessionId: session2._id, role: 'assistant', text: 'Yes, we support SSO.', at: new Date(Date.now() - 160000) });

        // SessionSummary fixture'ları
        const summary1 = await SessionSummary.create({
            sessionId: session1._id,
            tldr: 'Visitor asked about enterprise pricing and requested a demo.',
            topics: ['pricing', 'enterprise plan', 'demo'],
            objections: ['Too expensive'],
            unanswered: ['What is the SLA?'],
            sentiment: { overall: 'positive', perTurn: [] },
            dropOff: 2,
            nextStep: 'Schedule a demo',
            generatedAt: new Date()
        });
        testIds.summary1Id = String(summary1._id);

        const summary2 = await SessionSummary.create({
            sessionId: session2._id,
            tldr: 'Visitor asked about SSO integration.',
            topics: ['SSO', 'integration'],
            objections: [],
            unanswered: ['Does it support SAML?'],
            sentiment: { overall: 'neutral', perTurn: [] },
            dropOff: 1,
            nextStep: 'Send documentation',
            generatedAt: new Date()
        });
        testIds.summary2Id = String(summary2._id);

        // Lead fixture
        const lead = await Lead.create({
            sessionId: session1._id,
            workspaceId: workspace._id,
            agentId: agent._id,
            contact: { email: 'test@example.com', company: 'Acme Corp' },
            score: 80,
            status: 'qualified',
            signals: [
                { type: 'email_shared', value: 'test@example.com', weight: 20 },
                { type: 'demo_intent', value: true, weight: 30 },
                { type: 'long_session', value: 5, weight: 20 }
            ]
        });
        testIds.leadId = String(lead._id);

        // ── Test 6: GET /analytics/agents/:id ──────────────────────────────────
        console.log('📌 6. GET /analytics/agents/:id → KPI Testi');
        const kpiRes = await fetch(`http://localhost:${PORT}/api/v1/analytics/agents/${testIds.agentId}`, { headers });
        const kpiBody = await kpiRes.json();

        if (kpiRes.status === 200) ok('HTTP 200 döndü');
        else fail('HTTP 200 beklendi', `Status: ${kpiRes.status}, Body: ${JSON.stringify(kpiBody)}`);

        if (kpiBody.totalSessions === 2) ok(`totalSessions = 2 (${kpiBody.totalSessions})`);
        else fail('totalSessions yanlış', `Beklenen: 2, Gelen: ${kpiBody.totalSessions}`);

        if (typeof kpiBody.averageDurationSeconds === 'number' && kpiBody.averageDurationSeconds > 0)
            ok(`averageDurationSeconds hesaplanmış (${kpiBody.averageDurationSeconds}s)`);
        else
            fail('averageDurationSeconds hesaplanamadı', JSON.stringify(kpiBody));

        if (typeof kpiBody.completionRate === 'number')
            ok(`completionRate mevcut (${kpiBody.completionRate})`);
        else
            fail('completionRate eksik!', JSON.stringify(kpiBody));

        if (typeof kpiBody.unansweredRate === 'number')
            ok(`unansweredRate mevcut (${kpiBody.unansweredRate})`);
        else
            fail('unansweredRate eksik!', JSON.stringify(kpiBody));

        if (Array.isArray(kpiBody.timeSeries))
            ok('timeSeries array döndü');
        else
            fail('timeSeries eksik!', JSON.stringify(kpiBody));

        // ── Test 7: GET /analytics/agents/:id/summary ──────────────────────────
        console.log('\n📌 7. GET /analytics/agents/:id/summary → SessionSummary Listesi');
        const summaryRes = await fetch(`http://localhost:${PORT}/api/v1/analytics/agents/${testIds.agentId}/summary`, { headers });
        const summaryBody = await summaryRes.json();

        if (summaryRes.status === 200 && Array.isArray(summaryBody.summaries))
            ok('HTTP 200 ve summaries array döndü');
        else
            fail('summary endpoint başarısız', `Status: ${summaryRes.status}, Body: ${JSON.stringify(summaryBody)}`);

        if (summaryBody.total === 2)
            ok(`total = 2 (${summaryBody.total})`);
        else
            fail('total yanlış', `Beklenen: 2, Gelen: ${summaryBody.total}`);

        if (summaryBody.summaries.some(s => s.topics.includes('pricing')))
            ok("'pricing' konusu ilk summary'de var");
        else
            fail("'pricing' konusu bulunamadı");

        // ── Test 8: GET /analytics/products/:id/topics ─────────────────────────
        console.log('\n📌 8. GET /analytics/products/:id/topics → Topics Aggregation');
        const topicsRes = await fetch(`http://localhost:${PORT}/api/v1/analytics/products/${testIds.productId}/topics`, { headers });
        const topicsBody = await topicsRes.json();

        if (topicsRes.status === 200 && Array.isArray(topicsBody.topTopics))
            ok('HTTP 200 ve topTopics array döndü');
        else
            fail('topics endpoint başarısız', `Status: ${topicsRes.status}, Body: ${JSON.stringify(topicsBody)}`);

        if (topicsBody.topTopics.length > 0 && topicsBody.topTopics[0].topic)
            ok(`En yüksek topic: "${topicsBody.topTopics[0].topic}" (${topicsBody.topTopics[0].count}x)`);
        else
            fail('topTopics boş veya format hatalı', JSON.stringify(topicsBody));

        if (Array.isArray(topicsBody.topObjections))
            ok('topObjections array mevcut');
        else
            fail('topObjections eksik!', JSON.stringify(topicsBody));

        // ── Test 9: GET /analytics/leads ───────────────────────────────────────
        console.log('\n📌 9. GET /analytics/leads → Lead Listesi');
        const leadsRes = await fetch(
            `http://localhost:${PORT}/api/v1/analytics/leads?workspaceId=${testIds.workspaceId}`,
            { headers }
        );
        const leadsBody = await leadsRes.json();

        if (leadsRes.status === 200 && Array.isArray(leadsBody.leads))
            ok('HTTP 200 ve leads array döndü');
        else
            fail('leads endpoint başarısız', `Status: ${leadsRes.status}, Body: ${JSON.stringify(leadsBody)}`);

        if (leadsBody.total >= 1)
            ok(`total >= 1 (${leadsBody.total})`);
        else
            fail('Lead bulunamadı', JSON.stringify(leadsBody));

        const qualifiedLead = leadsBody.leads.find(l => l.status === 'qualified');
        if (qualifiedLead && qualifiedLead.score === 80)
            ok(`Qualified lead bulundu, score = ${qualifiedLead.score}`);
        else
            fail('Qualified lead bulunamadı veya score yanlış', JSON.stringify(leadsBody));

        // minScore filtresi
        const highScoreRes = await fetch(
            `http://localhost:${PORT}/api/v1/analytics/leads?workspaceId=${testIds.workspaceId}&minScore=90`,
            { headers }
        );
        const highScoreBody = await highScoreRes.json();
        if (highScoreRes.status === 200 && highScoreBody.total === 0)
            ok('minScore filtresi çalışıyor (score 90+ → 0 sonuç)');
        else
            warn(`minScore filtresi beklenmedik sonuç: ${JSON.stringify(highScoreBody)}`);

        // ── Test 10: GET /analytics/knowledge-gaps ─────────────────────────────
        console.log('\n📌 10. GET /analytics/knowledge-gaps → Unanswered Sorular');
        const gapsRes = await fetch(
            `http://localhost:${PORT}/api/v1/analytics/knowledge-gaps?productId=${testIds.productId}`,
            { headers }
        );
        const gapsBody = await gapsRes.json();

        if (gapsRes.status === 200 && Array.isArray(gapsBody.gaps))
            ok('HTTP 200 ve gaps array döndü');
        else
            fail('knowledge-gaps endpoint başarısız', `Status: ${gapsRes.status}, Body: ${JSON.stringify(gapsBody)}`);

        if (gapsBody.gaps.length > 0 && gapsBody.gaps[0].question && gapsBody.gaps[0].count >= 1)
            ok(`En çok sorulan cevaplanmamış soru: "${gapsBody.gaps[0].question}" (${gapsBody.gaps[0].count}x)`);
        else
            fail('Gaps boş veya format hatalı', JSON.stringify(gapsBody));

        // ── Test 11: PATCH /sessions/:id/end ───────────────────────────────────
        console.log('\n📌 11. PATCH /sessions/:id/end → Session Bitişi + Analiz Enqueue');

        // Yeni live session oluştur
        const liveSession = await Session.create({
            agentId: agent._id,
            roomName: 'test-room-p4-live',
            status: 'live',
            startedAt: new Date(Date.now() - 60000)
        });
        testIds.liveSessionId = String(liveSession._id);

        const endRes = await fetch(
            `http://localhost:${PORT}/api/v1/sessions/${testIds.liveSessionId}/end`,
            { method: 'PATCH', headers }
        );
        const endBody = await endRes.json();

        if (endRes.status === 200 && endBody.ok === true)
            ok('PATCH /sessions/:id/end → 200 ok: true');
        else
            fail('PATCH /sessions/:id/end başarısız', `Status: ${endRes.status}, Body: ${JSON.stringify(endBody)}`);

        // Verify DB'de session status güncellendi
        const updatedSession = await Session.findById(liveSession._id);
        if (updatedSession.status === 'ended')
            ok("Session status 'ended' olarak güncellendi");
        else
            fail('Session status güncellenemedi', updatedSession.status);

        // Zaten ended olan session'a tekrar end çekince 400 dönmeli
        const doubleEndRes = await fetch(
            `http://localhost:${PORT}/api/v1/sessions/${testIds.liveSessionId}/end`,
            { method: 'PATCH', headers }
        );
        if (doubleEndRes.status === 400)
            ok('Zaten ended session → 400 Bad Request (idempotent guard)');
        else
            warn(`Çift end isteği: ${doubleEndRes.status} (400 beklendi)`);

        // ═══════════════════════════════════════════════════════════════════════
        // BÖLÜM 3: CONSOLE CRUD MANAGEMENT TESTLERİ
        // ═══════════════════════════════════════════════════════════════════════
        console.log('\n' + '─'.repeat(60));
        console.log('🛠️  Console CRUD Testleri Başlıyor...\n');

        // ── Test 12: PATCH /agents/:id ─────────────────────────────────────────
        console.log('📌 12. PATCH /agents/:id → Persona & Avatar Güncelleme');
        try {
            const patchRes = await fetch(
                `http://localhost:${PORT}/api/v1/agents/${testIds.agentId}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        name: 'Updated Agent Name',
                        persona: { tone: 'formal', goals: ['close deals', 'qualify leads'] },
                        avatarProvider: 'voice-only'
                    })
                }
            );
            const patchData = await patchRes.json();
            if (patchRes.status === 200) ok('HTTP 200 döndü');
            else fail('PATCH /agents/:id başarısız', `${patchRes.status}: ${JSON.stringify(patchData)}`);

            if (patchData.name === 'Updated Agent Name') ok('name alanı güncellendi');
            else fail('name güncellenmedi', JSON.stringify(patchData.name));

            if (patchData.persona?.tone === 'formal') ok('persona.tone güncellendi');
            else fail('persona.tone güncellenmedi', JSON.stringify(patchData.persona));

            if (Array.isArray(patchData.persona?.goals) && patchData.persona.goals.includes('close deals'))
                ok('persona.goals güncellendi');
            else fail('persona.goals güncellenmedi', JSON.stringify(patchData.persona?.goals));
        } catch (e) {
            fail('PATCH /agents/:id hatası', e.message);
        }

        // ── Test 13: DELETE /agents/:id — live session guard ──────────────────
        console.log('\n📌 13. DELETE /agents/:id → Live Session Guard (409)');
        try {
            // Önce live session oluştur
            const liveAgentId = testIds.agentId;
            const liveSessionForDelete = await Session.create({
                agentId: liveAgentId,
                roomName: 'test-live-delete-guard',
                status: 'live'
            });

            const guardRes = await fetch(
                `http://localhost:${PORT}/api/v1/agents/${liveAgentId}`,
                { method: 'DELETE', headers }
            );
            if (guardRes.status === 409) ok('Live session varken DELETE → 409 Conflict');
            else fail('Live session guard çalışmıyor', `${guardRes.status} (409 beklendi)`);

            // Live session'ı temizle
            await Session.deleteOne({ _id: liveSessionForDelete._id });
        } catch (e) {
            fail('DELETE /agents/:id live guard hatası', e.message);
        }

        // ── Test 14: DELETE /agents/:id — cascade ─────────────────────────────
        console.log('\n📌 14. DELETE /agents/:id → Cascade Silme');
        try {
            // Silinecek ayrı bir agent oluştur
            const { ShareLink: SL } = await import('@repo/database');
            const tempAgent = await Agent.create({
                productId: testIds.productId,
                name: 'Temp Agent For Delete',
                status: 'draft'
            });
            await SL.create({ agentId: tempAgent._id, token: `del-test-${Date.now()}` });

            const delRes = await fetch(
                `http://localhost:${PORT}/api/v1/agents/${tempAgent._id}`,
                { method: 'DELETE', headers }
            );
            const delData = await delRes.json();
            if (delRes.status === 200 && delData.ok) ok('DELETE /agents/:id → 200 ok');
            else fail('DELETE /agents/:id başarısız', `${delRes.status}: ${JSON.stringify(delData)}`);

            // Agent silinmiş mi?
            const gone = await Agent.findById(tempAgent._id);
            if (!gone) ok('Agent veritabanından silindi');
            else fail('Agent hâlâ veritabanında var!');

            // ShareLink da silinmiş mi?
            const linkGone = await SL.findOne({ agentId: tempAgent._id });
            if (!linkGone) ok('ShareLink cascade silinmesi çalıştı');
            else fail('ShareLink silinmedi!');
        } catch (e) {
            fail('DELETE /agents/:id cascade hatası', e.message);
        }

        // ── Test 15: PATCH /products/:id ──────────────────────────────────────
        console.log('\n📌 15. PATCH /products/:id → İsim ve Açıklama Güncelleme');
        try {
            const patchProdRes = await fetch(
                `http://localhost:${PORT}/api/v1/products/${testIds.productId}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        name: 'Updated Product Name',
                        description: 'Güncellenmiş açıklama'
                    })
                }
            );
            const patchProdData = await patchProdRes.json();
            if (patchProdRes.status === 200) ok('HTTP 200 döndü');
            else fail('PATCH /products/:id başarısız', `${patchProdRes.status}: ${JSON.stringify(patchProdData)}`);

            if (patchProdData.name === 'Updated Product Name') ok('name alanı güncellendi');
            else fail('name güncellenmedi', JSON.stringify(patchProdData));

            if (patchProdData.description === 'Güncellenmiş açıklama') ok('description güncellendi');
            else fail('description güncellenmedi', JSON.stringify(patchProdData));
        } catch (e) {
            fail('PATCH /products/:id hatası', e.message);
        }

        // ── Test 16: DELETE /products/:id — live session guard ────────────────
        console.log('\n📌 16. DELETE /products/:id → Live Session Guard (409)');
        try {
            // Canlı session oluştur (mevcut agentId ile)
            const liveSessionForProdDelete = await Session.create({
                agentId: testIds.agentId,
                roomName: 'test-prod-live-guard',
                status: 'live'
            });

            const guardProdRes = await fetch(
                `http://localhost:${PORT}/api/v1/products/${testIds.productId}`,
                { method: 'DELETE', headers }
            );
            if (guardProdRes.status === 409) ok('Live session varken DELETE /products → 409 Conflict');
            else fail('Ürün live session guard çalışmıyor', `${guardProdRes.status} (409 beklendi)`);

            await Session.deleteOne({ _id: liveSessionForProdDelete._id });
        } catch (e) {
            fail('DELETE /products/:id live guard hatası', e.message);
        }

        // ── Test 17: DELETE /products/:id — cascade ───────────────────────────
        console.log('\n📌 17. DELETE /products/:id → Cascade Silme');
        try {
            const { ShareLink: SL2 } = await import('@repo/database');
            // Yeni bir product + agent oluştur (aynı workspace'te, membership zaten var)
            const tempProd = await Product.create({ workspaceId: testIds.workspaceId, name: 'Temp Prod For Delete' });
            const tempAgent2 = await Agent.create({ productId: tempProd._id, name: 'Temp Agent2', status: 'draft' });
            await SL2.create({ agentId: tempAgent2._id, token: `del-prod-${Date.now()}` });

            const delProdRes = await fetch(
                `http://localhost:${PORT}/api/v1/products/${tempProd._id}`,
                { method: 'DELETE', headers }
            );
            const delProdData = await delProdRes.json();
            if (delProdRes.status === 200 && delProdData.ok) ok('DELETE /products/:id → 200 ok');
            else fail('DELETE /products/:id başarısız', `${delProdRes.status}: ${JSON.stringify(delProdData)}`);

            // Cascade kontrolleri
            const prodGone = await Product.findById(tempProd._id);
            if (!prodGone) ok('Product veritabanından silindi');
            else fail('Product hâlâ var!');

            const agentGone = await Agent.findById(tempAgent2._id);
            if (!agentGone) ok('Bağlı Agent cascade silindi');
            else fail('Bağlı Agent silinmedi!');

            const linkGone2 = await SL2.findOne({ agentId: tempAgent2._id });
            if (!linkGone2) ok('Bağlı ShareLink cascade silindi');
            else fail('Bağlı ShareLink silinmedi!');
        } catch (e) {
            fail('DELETE /products/:id cascade hatası', e.message);
        }

        // ── Test 18: DELETE /sessions/:id — live guard ────────────────────────
        console.log('\n📌 18. DELETE /sessions/:id → Live Session Guard (409)');
        try {
            const liveSessionToDel = await Session.create({
                agentId: testIds.agentId,
                roomName: 'test-session-del-live',
                status: 'live'
            });

            const liveDelRes = await fetch(
                `http://localhost:${PORT}/api/v1/sessions/${liveSessionToDel._id}`,
                { method: 'DELETE', headers }
            );
            if (liveDelRes.status === 409) ok('Live session silinemiyor → 409 Conflict');
            else fail('Live session guard çalışmıyor', `${liveDelRes.status} (409 beklendi)`);

            await Session.deleteOne({ _id: liveSessionToDel._id });
        } catch (e) {
            fail('DELETE /sessions/:id live guard hatası', e.message);
        }

        // ── Test 19: DELETE /sessions/:id — cascade ───────────────────────────
        console.log('\n📌 19. DELETE /sessions/:id → Cascade Silme');
        try {
            const tempSession = await Session.create({
                agentId: testIds.agentId,
                roomName: 'test-session-cascade-del',
                status: 'ended',
                endedAt: new Date()
            });
            await Message.create({ sessionId: tempSession._id, role: 'user', text: 'Test msg', at: new Date() });
            await Message.create({ sessionId: tempSession._id, role: 'assistant', text: 'Response', at: new Date() });

            const sessionDelRes = await fetch(
                `http://localhost:${PORT}/api/v1/sessions/${tempSession._id}`,
                { method: 'DELETE', headers }
            );
            const sessionDelData = await sessionDelRes.json();
            if (sessionDelRes.status === 200 && sessionDelData.ok) ok('DELETE /sessions/:id → 200 ok');
            else fail('DELETE /sessions/:id başarısız', `${sessionDelRes.status}: ${JSON.stringify(sessionDelData)}`);

            const sesGone = await Session.findById(tempSession._id);
            if (!sesGone) ok('Session veritabanından silindi');
            else fail('Session hâlâ var!');

            const msgCount = await Message.countDocuments({ sessionId: tempSession._id });
            if (msgCount === 0) ok('Bağlı mesajlar cascade silindi');
            else fail(`${msgCount} mesaj hâlâ var!`);
        } catch (e) {
            fail('DELETE /sessions/:id cascade hatası', e.message);
        }

        // ── Test 20: DELETE /sessions/:id — 404 ──────────────────────────────
        console.log('\n📌 20. DELETE /sessions/:id → 404 Not Found');
        try {
            const fakeId = new mongoose.Types.ObjectId();
            const notFoundRes = await fetch(
                `http://localhost:${PORT}/api/v1/sessions/${fakeId}`,
                { method: 'DELETE', headers }
            );
            if (notFoundRes.status === 404) ok('Var olmayan session → 404 Not Found');
            else fail('404 guard çalışmıyor', `${notFoundRes.status} (404 beklendi)`);
        } catch (e) {
            fail('DELETE /sessions/:id 404 guard hatası', e.message);
        }

    } catch (e) {
        fail('HTTP test sırasında beklenmeyen hata', e.stack || e.message);
    } finally {
        // ── Cleanup ────────────────────────────────────────────────────────────
        try {
            if (testIds.summary1Id) await SessionSummary.deleteOne({ _id: testIds.summary1Id });
            if (testIds.summary2Id) await SessionSummary.deleteOne({ _id: testIds.summary2Id });
            if (testIds.leadId) await Lead.deleteOne({ _id: testIds.leadId });
            if (testIds.liveSessionId) {
                await Session.deleteOne({ _id: testIds.liveSessionId });
                await Message.deleteMany({ sessionId: testIds.liveSessionId });
            }
            if (testIds.session1Id) {
                await Session.deleteOne({ _id: testIds.session1Id });
                await Message.deleteMany({ sessionId: testIds.session1Id });
            }
            if (testIds.session2Id) {
                await Session.deleteOne({ _id: testIds.session2Id });
                await Message.deleteMany({ sessionId: testIds.session2Id });
            }
            if (testIds.agentId) await Agent.deleteOne({ _id: testIds.agentId });
            if (testIds.productId) await Product.deleteOne({ _id: testIds.productId });
            if (testIds.workspaceId) await Workspace.deleteOne({ _id: testIds.workspaceId });
        } catch (cleanupErr) {
            console.warn('⚠️  Cleanup sırasında hata (non-fatal):', cleanupErr.message);
        }

        if (server) server.close();
    }

    // ── Sonuçlar ────────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log(`Sonuçlar: ${passed} başarılı, ${failed} başarısız`);
    if (failed === 0) {
        console.log('🎉 Phase 4 testlerinin tamamı başarıyla geçti!\n');
        process.exit(0);
    } else {
        console.error('💥 Bazı testler başarısız oldu!\n');
        process.exit(1);
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
