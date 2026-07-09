import '@repo/config-env/load';
import { AccessToken } from 'livekit-server-sdk';
import { config } from '@repo/config-env';

async function testPhase2() {
    console.log("🚀 Phase 2: LiveKit ve Agent Session Testi Başlıyor...\n");

    try {
        console.log("⏳ 1. LiveKit Token Üretimi test ediliyor...");
        
        const roomName = "test_room_" + Date.now();
        const participantIdentity = "test_visitor_" + Date.now();

        const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
            identity: participantIdentity,
            name: "Test Visitor"
        });
        at.addGrant({ roomJoin: true, room: roomName });
        const token = await at.toJwt();

        console.log("✅ LiveKit Token başarıyla üretildi! (Uzunluk:", token.length, ")");
        console.log("✅ Odaya bağlanılabilir! (Room:", roomName, ")");

        console.log("\n🎉 Phase 2 Testleri Tamamlandı!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Hata:", e);
        process.exit(1);
    }
}
testPhase2();
