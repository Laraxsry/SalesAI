import { Schema, model } from 'mongoose';

/**
 * SessionEvent — bir oturumda OLAN HER ŞEYİN kronolojik ham kaydı.
 *
 * Amaç: bir oturumu sonradan, satır satır, birebir yeniden kurabilmek —
 * model ne zaman konuştu, ekranda hangi URL vardı, ziyaretçi mikrofonu ne
 * zaman açtı, Playwright arka planda ne yapıyordu. Terminal logu yalnızca
 * o an oradaysan işe yarar; burası sorgulanabilir ve kalıcıdır.
 *
 * Yazan tek yer: apps/agent-worker/src/session-timeline.js. Doğrudan
 * `SessionEvent.create(...)` çağırma — `seq` ve `t` alanlarını tutarlı
 * üretebilen tek yer orası (aşağıya bak).
 *
 * *** NEDEN `at` TEK BAŞINA YETMEZ ***
 * Aynı milisaniyede birden fazla olay olabiliyor (tool sonucu + node
 * kapanışı + yeni navigasyon hepsi bir microtask turunda) ve `at`'e göre
 * sıralamak bunları rastgele sıraya sokuyor — canlı hata ayıklarken en çok
 * ihtiyaç duyulan yer tam olarak orası. `seq` oturum içinde monoton artan
 * bir sayaç, `t` ise oturum başından beri geçen milisaniye: ilki kesin
 * sıralama, ikincisi "ne kadar sonra" sorusunun cevabı.
 *
 * GDPR: apps/api/src/routes/privacy.js hem dışa aktarır hem siler,
 * apps/worker-general/src/handlers/purge-expired-data.js saklama süresi
 * dolunca temizler — yeni bir koleksiyon açmak yerine bunun genişletilmiş
 * olmasının başlıca sebebi bu, iki uyum yolu da bedavaya geliyor.
 */
const SessionEventSchema = new Schema(
    {
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
            index: true
        },
        /**
         * Noktalı olay adı — `alan.nesne.durum` (örn. `playbook.node.enter`,
         * `media.mic.on`, `screen.navigate.end`).
         *
         * Bilinçli olarak enum DEĞİL: sözlük büyüdükçe her yeni olay için
         * şema migrasyonu gerekmesin diye. Geçerli değerlerin tek kaynağı
         * session-timeline.js'teki `TIMELINE_EVENTS` sabitleri.
         *
         * Eski (hiç yazılmamış) sözlük, geriye dönük okuma için: session_started,
         * tool_called, tour_started, screen_shared, handoff_requested,
         * session_ended.
         */
        type: { type: String, required: true, index: true },
        /** Oturum içinde monoton artan sıra numarası — kesin kronoloji. */
        seq: { type: Number, required: true },
        /** Oturum başlangıcından beri geçen milisaniye. */
        t: { type: Number, required: true },
        /** Olayın gerçekleştiği mutlak zaman. */
        at: { type: Date, default: Date.now, index: true },
        /** Süreli olaylarda (navigasyon, tool çağrısı) ölçülen süre. */
        durationMs: { type: Number },
        /** Olay türüne özgü ek veri (URL, tool adı, durum geçişi vb.). */
        meta: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

// Tek gerçek okuma deseni: "şu oturumun tüm olayları, sırasıyla".
SessionEventSchema.index({ sessionId: 1, seq: 1 });

export const SessionEvent = model('SessionEvent', SessionEventSchema);
