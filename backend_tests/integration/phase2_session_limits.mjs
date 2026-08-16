import '@repo/config-env/load';
import { connectDB, ShareLink, Agent } from '@repo/database';
import mongoose from 'mongoose';

async function testLimits() {
    console.log("🚀 Phase 2: Session Limits Test Başlıyor...\n");
    await connectDB();
    
    // Geçici bir Agent oluştur
    const agent = await Agent.create({
        productId: new mongoose.Types.ObjectId(),
        workspaceId: new mongoose.Types.ObjectId(),
        name: "Test Agent",
        status: "active"
    });
    
    // 1. Süresi dolmuş Link
    const expiredLink = await ShareLink.create({
        agentId: agent._id,
        token: "expired_token_" + Date.now(),
        expiresAt: new Date(Date.now() - 10000), // 10 saniye önce dolmuş
        active: true
    });
    
    // 2. Limitini doldurmuş Link
    const maxSessionsLink = await ShareLink.create({
        agentId: agent._id,
        token: "max_token_" + Date.now(),
        maxSessions: 2,
        sessionCount: 2, // Limite ulaşmış
        active: true
    });
    
    let success = true;

    // 1. Test
    console.log("⏳ Süresi dolmuş (expired) link test ediliyor...");
    try {
        const res1 = await fetch('http://localhost:5001/api/v1/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shareToken: expiredLink.token, visitorName: 'Test' })
        });
        const body1 = await res1.json();
        if (res1.status === 403 && body1.error === 'Share link has expired') {
            console.log("  ✅ Expired link doğru bir şekilde 403 ile reddedildi.");
        } else {
            console.error("  ❌ Expired link engellenmedi! Status:", res1.status, "Body:", body1);
            success = false;
        }
    } catch (e) {
        console.error("  ❌ Hata:", e.message);
        success = false;
    }
    
    // 2. Test
    console.log("⏳ Session limitini doldurmuş link test ediliyor...");
    try {
        const res2 = await fetch('http://localhost:5001/api/v1/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shareToken: maxSessionsLink.token, visitorName: 'Test' })
        });
        const body2 = await res2.json();
        if (res2.status === 403 && body2.error === 'Share link has reached its session limit') {
            console.log("  ✅ Max sessions link doğru bir şekilde 403 ile reddedildi.");
        } else {
            console.error("  ❌ Max sessions link engellenmedi! Status:", res2.status, "Body:", body2);
            success = false;
        }
    } catch (e) {
        console.error("  ❌ Hata:", e.message);
        success = false;
    }
    
    // Temizlik
    await ShareLink.deleteMany({ _id: { $in: [expiredLink._id, maxSessionsLink._id] } });
    await Agent.deleteOne({ _id: agent._id });
    
    if (success) {
        console.log("\n🎉 Tüm limit testleri başarıyla tamamlandı!");
        process.exit(0);
    } else {
        console.error("\n💥 Bazı limit testleri başarısız oldu!");
        process.exit(1);
    }
}

testLimits().catch(e => {
    console.error("Beklenmeyen hata:", e);
    process.exit(1);
});
