import '@repo/config-env/load';
import { connectDB, mongoose } from '@repo/database';
import { s3Client } from '@repo/database/src/s3.js';

async function testPhase0() {
    console.log("🚀 Phase 0: Veritabanı ve MinIO Testi Başlıyor...\n");

    try {
        console.log("⏳ 1. MongoDB bağlantısı test ediliyor...");
        await connectDB();
        console.log("✅ MongoDB bağlantısı başarılı! (Durum:", mongoose.connection.readyState, ")");

        console.log("⏳ 2. MinIO (S3) bağlantısı test ediliyor...");
        const buckets = await s3Client.listBuckets().promise();
        console.log("✅ MinIO bağlantısı başarılı! Mevcut Bucket Sayısı:", buckets.Buckets.length);

        console.log("\n🎉 Phase 0 Testleri Tamamlandı!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Hata:", e);
        process.exit(1);
    }
}
testPhase0();
