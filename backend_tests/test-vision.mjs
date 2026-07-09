import '@repo/config-env/load';
import { analyzeFrame } from '@repo/screen';
import fs from 'fs';
import path from 'path';

async function testCustomerScreen() {
    const imagePath = path.join(process.cwd(), 'test-screen.png');

    console.log("1. Ekran görüntüsü (test-screen.png) aranıyor...");
    if (!fs.existsSync(imagePath)) {
        console.error("❌ HATA: Proje ana dizininde 'test-screen.png' adında bir resim bulunamadı!");
        console.log("👉 Lütfen kendi YouTube veya test etmek istediğin herhangi bir ekranının ekran görüntüsünü (screenshot) al.");
        console.log("👉 Sonra bu resmi projenin olduğu klasöre (SalesAI dizinine) 'test-screen.png' ismiyle kaydet ve testi tekrar çalıştır.");
        process.exit(1);
    }

    console.log("✅ Resim bulundu! Okunuyor...");
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = "data:image/png;base64," + imageBuffer.toString('base64');

    console.log("2. OpenAI Vision API'ye (Ajanın Gözlerine) gönderiliyor...");
    // Ajan sanki LiveKit üzerinden canlı yayında müşterinin ekranından bu kareyi almış gibi simüle ediyoruz:
    const analysis = await analyzeFrame(base64Image, 'Bu ekranda ne görüyorsun? Hangi hesaplara giriş yapılmış, hangi videolar veya metinler var? Detaylı anlat.');
    
    console.log("\n✅ AI (Ajan) Cevabı:\n");
    console.log(analysis);

    process.exit(0);
}

testCustomerScreen();
