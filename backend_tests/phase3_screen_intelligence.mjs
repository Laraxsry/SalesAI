/**
 * Phase 3 — Screen Intelligence: Otomatik Test Paketi
 *
 * Test Kapsamı:
 *  1. GuidedTour sınıfının çalıştırılabilirliği (Playwright)
 *  2. Tarayıcı havuzu (concurrency) limiti — max 3
 *  3. screenModes gating — agent.js kaynak kodu doğrulaması
 *  4. sharp bağımlılığı ve ARGB→JPEG dönüşüm mantığı
 *  5. analyzeFrame (vision) — gerçek OpenAI çağrısı (OPENAI_API_KEY gerekli)
 *  6. messages.meta kaydı — agent.js kaynak kodu doğrulaması
 */

import '@repo/config-env/load';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sharp from 'sharp';
import http from 'node:http';

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
    console.log('\n🖥️  Phase 3 — Screen Intelligence Testleri Başlıyor...\n');

    // ── Test 1: cobrowse.js kaynak — havuz değişkenleri var mı? ──────────────
    console.log('📌 1. cobrowse.js → Tarayıcı Havuzu (Pool) Kontrolü');
    try {
        const cobrowseSrc = readFileSync(join(ROOT, 'packages/screen/src/cobrowse.js'), 'utf-8');

        if (cobrowseSrc.includes('activeBrowsers'))
            ok('activeBrowsers Set tanımlı');
        else
            fail('activeBrowsers bulunamadı!');

        if (cobrowseSrc.includes('MAX_CONCURRENT_BROWSERS'))
            ok('MAX_CONCURRENT_BROWSERS limiti tanımlı');
        else
            fail('MAX_CONCURRENT_BROWSERS yok!');

        if (cobrowseSrc.includes('MAX_TOUR_BROWSERS'))
            ok('MAX_TOUR_BROWSERS env var override destekleniyor');
        else
            fail('MAX_TOUR_BROWSERS env desteği yok!');

        if (cobrowseSrc.includes('activeBrowsers.add('))
            ok('Tarayıcı açıldığında havuza ekleniyor');
        else
            fail('activeBrowsers.add() çağrısı yok!');

        if (cobrowseSrc.includes('activeBrowsers.delete('))
            ok('Tarayıcı kapandığında havuzdan siliniyor');
        else
            fail('activeBrowsers.delete() çağrısı yok!');
    } catch (e) {
        fail('cobrowse.js okunamadı', e.message);
    }

    // ── Test 2: Concurrency limit — 3 browser ardışık açılabilir, 4. reddedilmeli ─
    console.log('\n📌 2. GuidedTour → Concurrency Limiti Testi');
    const tours = [];
    try {
        const { GuidedTour } = await import('@repo/screen');
        const maxLimit = process.env.MAX_TOUR_BROWSERS ? parseInt(process.env.MAX_TOUR_BROWSERS, 10) : 3;

        console.log(`     (Mevcut limit: ${maxLimit})`);

        // Limite kadar tarayıcı aç
        for (let i = 0; i < maxLimit; i++) {
            const t = new GuidedTour({ startUrl: 'about:blank' });
            await t.open();
            tours.push(t);
        }
        ok(`${maxLimit} eşzamanlı tarayıcı başarıyla açıldı`);

        // Limitin bir fazlası hata fırlatmalı
        let threw = false;
        const extraTour = new GuidedTour({ startUrl: 'about:blank' });
        try {
            await extraTour.open();
        } catch (e) {
            if (e.message.includes('Concurrent browser limit')) {
                ok(`${maxLimit + 1}. tarayıcı isteği beklendiği gibi reddedildi`);
                threw = true;
            } else {
                fail(`${maxLimit + 1}. tarayıcı reddedildi ama hata mesajı yanlış`, e.message);
                threw = true;
            }
        }
        if (!threw) fail(`Limit (${maxLimit}) aşıldı ama hata fırlatılmadı!`);
    } catch (e) {
        fail('Playwright başlatılamadı', e.message);
        warn('Bu test için Playwright ve Chromium kurulu olmalıdır');
    } finally {
        // Açık tarayıcıları kapat
        for (const t of tours) {
            try { await t.close(); } catch { /* best-effort cleanup */ }
        }
    }

    // ── Test 3: agent.js → screenModes gating var mı? ────────────────────────
    console.log('\n📌 3. agent.js → screenModes Gating Kontrolü');
    try {
        const agentSrc = readFileSync(join(ROOT, 'apps/agent-worker/src/agent.js'), 'utf-8');

        if (agentSrc.includes("screenModes.includes('guided-tour')"))
            ok("'guided-tour' modu için screenModes kontrolü var");
        else
            fail("screenModes.includes('guided-tour') bulunamadı!");

        if (agentSrc.includes("screenModes.includes('customer-share')"))
            ok("'customer-share' modu için screenModes kontrolü var");
        else
            fail("screenModes.includes('customer-share') bulunamadı!");

        if (agentSrc.includes('agentDoc.screenModes'))
            ok('screenModes agentDoc üzerinden alınıyor');
        else
            fail('agentDoc.screenModes referansı yok!');
    } catch (e) {
        fail('agent.js okunamadı', e.message);
    }

    // ── Test 4: agent.js → LiveKit VideoSource/VideoStream var mı? ───────────
    console.log('\n📌 4. agent.js → LiveKit Video Publish/Subscribe Kontrolü');
    try {
        const agentSrc = readFileSync(join(ROOT, 'apps/agent-worker/src/agent.js'), 'utf-8');

        if (agentSrc.includes('VideoSource'))
            ok('VideoSource import edilmiş');
        else
            fail('VideoSource bulunamadı!');

        if (agentSrc.includes('VideoStream'))
            ok('VideoStream import edilmiş (müşteri ekranı okuma için)');
        else
            fail('VideoStream bulunamadı!');

        if (agentSrc.includes('captureFrame'))
            ok('tourVideoSource.captureFrame() çağrısı var (frame push)');
        else
            fail('captureFrame() çağrısı yok!');

        if (agentSrc.includes('publishTrack'))
            ok('localParticipant.publishTrack() çağrısı var');
        else
            fail('publishTrack() çağrısı yok!');

        if (agentSrc.includes('TrackSource.SOURCE_SCREENSHARE'))
            ok("Track tipi 'SOURCE_SCREENSHARE' olarak ayarlanmış");
        else
            fail("TrackSource.SOURCE_SCREENSHARE track tipi yok!");
    } catch (e) {
        fail('agent.js okunamadı', e.message);
    }

    // ── Test 5: agent.js → messages.meta kaydı ───────────────────────────────
    console.log('\n📌 5. agent.js → Ekran Aksiyonlarının messages.meta Kaydı');
    try {
        const agentSrc = readFileSync(join(ROOT, 'apps/agent-worker/src/agent.js'), 'utf-8');

        const metaActions = ['tour_started', 'navigate_to', 'highlight', 'vision_read'];
        for (const action of metaActions) {
            if (agentSrc.includes(`action: '${action}'`))
                ok(`'${action}' aksiyonu messages.meta'ya kaydediliyor`);
            else
                fail(`'${action}' aksiyonu meta'da yok!`);
        }

        if (agentSrc.includes("role: 'system'"))
            ok("Sistem mesajları 'system' rolüyle kaydediliyor");
        else
            fail("'system' rolü yok!");
    } catch (e) {
        fail('agent.js okunamadı', e.message);
    }

    // ── Test 6: sharp dönüşüm testi — RGBA buffer'ı JPEG'e çevir ─────────────
    console.log('\n📌 6. sharp → ARGB→JPEG Dönüşüm Testi (1024px downscale)');
    try {
        // 1920x1080 saf kırmızı ARGB buffer simüle ediyoruz
        const W = 1920, H = 1080;
        const argbBuffer = Buffer.alloc(W * H * 4, 0);
        // Kırmızı piksel: RGBA = [255, 0, 0, 255]
        for (let i = 0; i < W * H * 4; i += 4) {
            argbBuffer[i] = 255;     // R
            argbBuffer[i + 1] = 0;   // G
            argbBuffer[i + 2] = 0;   // B
            argbBuffer[i + 3] = 255; // A
        }

        const jpegBuffer = await sharp(argbBuffer, {
            raw: { width: W, height: H, channels: 4 }
        })
            .resize({ width: 1024, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

        if (jpegBuffer.length > 0)
            ok(`ARGB (${W}x${H}) → JPEG (1024px) dönüşümü başarılı (${jpegBuffer.length} byte)`);
        else
            fail('JPEG buffer boş!');

        const meta = await sharp(jpegBuffer).metadata();
        if (meta.width <= 1024)
            ok(`Çıktı genişliği: ${meta.width}px ≤ 1024px (token limiti dahilinde)`);
        else
            fail(`Çıktı genişliği ${meta.width}px — 1024px aşıldı!`);
    } catch (e) {
        fail('sharp dönüşüm testi başarısız', e.message);
    }

    // ── Test 7: analyzeFrame vision testi (OPENAI_API_KEY gerekli) ────────────
    console.log('\n📌 7. analyzeFrame → OpenAI Vision API Testi');
    if (!process.env.OPENAI_API_KEY) {
        warn('OPENAI_API_KEY yok — vision testi atlandı (env var ekleyin)');
    } else {
        try {
            const { analyzeFrame } = await import('@repo/screen');
            // 1x1 siyah PNG (minimum geçerli resim)
            const minPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const result = await analyzeFrame(minPng, 'Bu resimde ne var?');
            if (typeof result === 'string' && result.length > 0)
                ok(`analyzeFrame cevap döndürdü (${result.length} karakter)`);
            else
                fail('analyzeFrame boş yanıt döndürdü!');
        } catch (e) {
            fail('analyzeFrame başarısız', e.message);
        }
    }

    // ── Test 8: agent.js → Close handler'da cleanup var mı? ──────────────────
    console.log('\n📌 8. agent.js → Session Close Cleanup Kontrolü');
    try {
        const agentSrc = readFileSync(join(ROOT, 'apps/agent-worker/src/agent.js'), 'utf-8');

        if (agentSrc.includes('clearInterval(tourPublishInterval)'))
            ok('Tour publish interval Close event\'te temizleniyor');
        else
            fail('tourPublishInterval clearInterval yok!');

        if (agentSrc.includes('clearInterval(customerSampleInterval)'))
            ok('Customer sample interval Close event\'te temizleniyor');
        else
            fail('customerSampleInterval clearInterval yok!');

        if (agentSrc.includes('await tour.close()'))
            ok('Playwright tarayıcısı session kapanınca kapatılıyor');
        else
            fail('tour.close() close handler\'da yok!');
    } catch (e) {
        fail('agent.js okunamadı', e.message);
    }

    // ── Test 9: SSRF guard — goto() reddediyor mu? ───────────────────────────
    console.log('\n📌 9. GuidedTour.goto() → SSRF Guard Testi');
    let ssrfServer;
    let ssrfTour;
    try {
        // Spin up a tiny local HTTP server so this test has no external
        // network dependency (avoids CI flakiness) — the "legitimate
        // navigation" case below only ever talks to this local server.
        ssrfServer = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
        });
        await new Promise((resolve) => ssrfServer.listen(0, '127.0.0.1', resolve));
        const { port } = ssrfServer.address();
        const origin = `http://127.0.0.1:${port}`;

        const { GuidedTour } = await import('../packages/screen/src/cobrowse.js');
        ssrfTour = new GuidedTour({ startUrl: `${origin}/` });
        await ssrfTour.open();

        const rejectedCases = [
            ['http://169.254.169.254/latest/meta-data/', 'cloud metadata endpoint'],
            ['file:///etc/passwd', 'file:// yerel dosya erişimi'],
            ['https://evil.example/phish', 'farklı domain']
        ];
        for (const [url, label] of rejectedCases) {
            try {
                await ssrfTour.goto(url);
                fail(`${label} reddedilmedi!`, url);
            } catch (e) {
                // Confirm this was our guard, not a coincidental network error.
                if (e.message.startsWith('[GuidedTour]')) {
                    ok(`${label} reddedildi (${e.message})`);
                } else {
                    fail(`${label} beklenmeyen bir hatayla başarısız oldu`, e.message);
                }
            }
        }

        try {
            await ssrfTour.goto(`${origin}/features`);
            ok('Aynı origin içindeki farklı path (meşru navigasyon) kabul edildi');
        } catch (e) {
            fail('Meşru aynı-origin navigasyon reddedildi!', e.message);
        }
    } catch (e) {
        fail('SSRF guard testi çalıştırılamadı', e.message);
        warn('Bu test için Playwright ve Chromium kurulu olmalıdır');
    } finally {
        if (ssrfTour) { try { await ssrfTour.close(); } catch { /* best-effort cleanup */ } }
        if (ssrfServer) { await new Promise((resolve) => ssrfServer.close(resolve)); }
    }

    // ── Test 10-12: eTLD+1 geçişi — allowedDomains, post-redirect, click() ──
    // Üç yerel HTTP sunucu: "trusted" (ana ürün), "sister" (seller'ın console'da
    // ayrıca onayladığı portföy sitesi), "evil" (hiçbir zaman onaylanmamış 3.
    // taraf). Gerçek bir domain/DNS gerekmediği için hepsi 127.0.0.1 üzerinde,
    // farklı portlarda — trustKey() bu durumda tam origin'i (host+port)
    // karşılaştırdığı için bu üçü birbirinden ayrı sayılıyor.
    console.log('\n📌 10-12. eTLD+1 geçişi → allowedDomains, post-redirect, click() Testleri');
    let trustedServer, sisterServer, evilServer;
    let multiTour, redirectTour, clickTour;
    try {
        const { GuidedTour } = await import('../packages/screen/src/cobrowse.js');

        evilServer = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>evil</body></html>');
        });
        await new Promise((resolve) => evilServer.listen(0, '127.0.0.1', resolve));
        const evilOrigin = `http://127.0.0.1:${evilServer.address().port}`;

        sisterServer = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('sister site ok');
        });
        await new Promise((resolve) => sisterServer.listen(0, '127.0.0.1', resolve));
        const sisterOrigin = `http://127.0.0.1:${sisterServer.address().port}`;

        trustedServer = http.createServer((req, res) => {
            if (req.url === '/redirect-away') {
                res.writeHead(302, { Location: `${evilOrigin}/` });
                res.end();
            } else if (req.url === '/with-evil-link') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<html><body><a href="${evilOrigin}/" id="evil-link">evil</a></body></html>`);
            } else if (req.url === '/with-same-site-link') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><a href="/features" id="same-link">features</a></body></html>');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('trusted ok');
            }
        });
        await new Promise((resolve) => trustedServer.listen(0, '127.0.0.1', resolve));
        const trustedOrigin = `http://127.0.0.1:${trustedServer.address().port}`;

        // ── Test 10: tourAllowedDomains — portföy sitesine izin verilmiş mi? ──
        multiTour = new GuidedTour({ startUrl: `${trustedOrigin}/`, allowedDomains: [sisterOrigin] });
        await multiTour.open();
        try {
            await multiTour.goto(`${sisterOrigin}/`);
            ok('allowedDomains ile eklenen portföy sitesine (sister) navigasyon kabul edildi');
        } catch (e) {
            fail('allowedDomains ile eklenen meşru site reddedildi!', e.message);
        }
        try {
            await multiTour.goto(`${evilOrigin}/`);
            fail('allowedDomains listesinde OLMAYAN site reddedilmedi!', evilOrigin);
        } catch (e) {
            ok(`allowedDomains listesinde olmayan site reddedildi (${e.message})`);
        }
        await multiTour.close();

        // ── Test 11: post-redirect — trusted origin'in kendi redirect'i ile
        // dışarı çıkma denemesi yakalanıyor mu? ─────────────────────────────
        redirectTour = new GuidedTour({ startUrl: `${trustedOrigin}/` });
        await redirectTour.open();
        try {
            await redirectTour.goto(`${trustedOrigin}/redirect-away`);
            fail('Trusted origin\'in evil\'a redirect etmesi yakalanmadı!');
        } catch (e) {
            if (e.message.includes('landed outside')) {
                ok(`Open-redirect istismarı yakalandı (${e.message})`);
            } else {
                fail('Redirect reddedildi ama beklenmeyen bir hatayla', e.message);
            }
        }
        await redirectTour.close();

        // ── Test 12: click() — sayfadaki bir linke tıklamak guard'ı atlıyor mu? ─
        clickTour = new GuidedTour({ startUrl: `${trustedOrigin}/with-evil-link` });
        await clickTour.open();
        try {
            await clickTour.click('#evil-link');
            fail('click() ile evil origin\'e geçiş yakalanmadı — bypass hâlâ açık!');
        } catch (e) {
            if (e.message.includes('landed outside')) {
                ok(`click() ile trusted domain dışına çıkış yakalandı (${e.message})`);
            } else {
                fail('click() reddedildi ama beklenmeyen bir hatayla', e.message);
            }
        }
        await clickTour.close();

        // Aynı origin içindeki meşru bir link tıklaması hâlâ çalışmalı.
        clickTour = new GuidedTour({ startUrl: `${trustedOrigin}/with-same-site-link` });
        await clickTour.open();
        try {
            await clickTour.click('#same-link');
            ok('Aynı origin içindeki linke tıklama (meşru navigasyon) kabul edildi');
        } catch (e) {
            fail('Meşru, aynı-origin bir link tıklaması reddedildi!', e.message);
        }
        await clickTour.close();
        clickTour = null;
    } catch (e) {
        fail('eTLD+1 / click / redirect testleri çalıştırılamadı', e.message);
        warn('Bu test için Playwright ve Chromium kurulu olmalıdır');
    } finally {
        if (multiTour) { try { await multiTour.close(); } catch { /* best-effort cleanup */ } }
        if (redirectTour) { try { await redirectTour.close(); } catch { /* best-effort cleanup */ } }
        if (clickTour) { try { await clickTour.close(); } catch { /* best-effort cleanup */ } }
        if (trustedServer) { await new Promise((resolve) => trustedServer.close(resolve)); }
        if (sisterServer) { await new Promise((resolve) => sisterServer.close(resolve)); }
        if (evilServer) { await new Promise((resolve) => evilServer.close(resolve)); }
    }

    // ── Özet ──────────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log(`Sonuç: ${passed} geçti, ${failed} başarısız`);
    if (failed === 0) {
        console.log('🎉 Phase 3 Screen Intelligence testleri tamamlandı!\n');
        process.exit(0);
    } else {
        console.error('💥 Bazı testler başarısız!\n');
        process.exit(1);
    }
}

run().catch(e => { console.error('Test çöktü:', e); process.exit(1); });
