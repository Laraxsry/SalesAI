import '@repo/config-env/load';
import { qdrantClient, getVectorCollectionName } from '@repo/database/src/qdrant.js';
import { embedText } from '@repo/ai';

async function testPhase1() {
    console.log("🚀 Phase 1: RAG (Vektör Veritabanı) ve Embedding Testi Başlıyor...\n");

    try {
        console.log("⏳ 1. Qdrant Vektör DB bağlantısı test ediliyor...");
        const collections = await qdrantClient.getCollections();
        console.log("✅ Qdrant bağlantısı başarılı! Toplam Koleksiyon Sayısı:", collections.collections.length);

        console.log("⏳ 2. OpenAI Embedding Modeli test ediliyor...");
        const vector = await embedText("Merhaba Dünya");
        console.log(`✅ Embedding başarılı! Vektör boyutu: ${vector.length} (Örn: Ada-002 için 1536 olmalı)`);

        console.log("\n🎉 Phase 1 Testleri Tamamlandı!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Hata:", e);
        process.exit(1);
    }
}
testPhase1();
