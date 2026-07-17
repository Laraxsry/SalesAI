import { Schema, model } from 'mongoose';

/**
 * AnalyticsRollup — saatlik/günlük toplanmış metrikler.
 * rollup-analytics handler tarafından idempotent upsert ile güncellenir.
 *
 * Compound unique index: {scope, scopeId, bucket, bucketAt}
 * Bu sayede aynı bucket birden çok kez hesaplanırsa sadece güncellenir,
 * yeni kayıt oluşturulmaz (drift-safe, re-runnable).
 *
 * @see phase4_analytics_insights.md — Task 3: Rollups & aggregation
 */
const AnalyticsRollupSchema = new Schema(
    {
        /**
         * Hangi varlık için rollup hesaplandığı.
         * 'agent'   → belirli bir agent'a ait session'lar
         * 'product' → belirli bir product'a ait tüm agent session'ları
         */
        scope: { type: String, enum: ['agent', 'product'], required: true },
        /** Agent._id veya Product._id */
        scopeId: { type: Schema.Types.ObjectId, required: true },
        /**
         * Zaman dilimi çözünürlüğü.
         * 'hour' → bucketAt saatten kesilmiş (dakika=0, saniye=0)
         * 'day'  → bucketAt günden kesilmiş (saat=0, dakika=0, saniye=0)
         */
        bucket: { type: String, enum: ['hour', 'day'], required: true },
        /** Bucket'ın başlangıç zamanı (UTC). */
        bucketAt: { type: Date, required: true },
        /** Hesaplanan metrikler. */
        metrics: {
            /** Toplam session sayısı. */
            sessions: { type: Number, default: 0 },
            /** Biten session'ların ortalama süresi (saniye). */
            avgDurationSec: { type: Number, default: 0 },
            /**
             * Completion rate: dropOff'suz biten session / toplam ended session.
             * 0-1 aralığında float.
             */
            completionRate: { type: Number, default: 0 },
            /**
             * Unanswered rate: unanswered sorusu olan session / toplam ended session.
             * 0-1 aralığında float.
             */
            unansweredRate: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

// Idempotent rollup için compound unique index
AnalyticsRollupSchema.index(
    { scope: 1, scopeId: 1, bucket: 1, bucketAt: 1 },
    { unique: true }
);

export const AnalyticsRollup = model('AnalyticsRollup', AnalyticsRollupSchema);
