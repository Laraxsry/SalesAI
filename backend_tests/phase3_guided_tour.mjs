import '@repo/config-env/load';
import { GuidedTour, analyzeFrame } from '@repo/screen';

async function testAgentTools() {
    console.log("1. GuidedTour (Sanal Tarayıcı) Başlatılıyor...");
    const tour = new GuidedTour({ startUrl: 'https://salesai.com' });
    await tour.open();
    console.log("✅ Tarayıcı başarıyla açıldı!");

    console.log("2. Ekran Görüntüsü Alınıyor...");
    const buffer = await tour.screenshot();
    const base64Image = "data:image/png;base64," + buffer.toString('base64');
    console.log("✅ Ekran görüntüsü alındı!");

    console.log("3. OpenAI Vision API ile ekran okunuyor...");
    const analysis = await analyzeFrame(base64Image, 'Burada ne görüyorsun?');
    console.log("✅ AI Cevabı:", analysis);

    await tour.close();
    process.exit(0);
}
testAgentTools();
