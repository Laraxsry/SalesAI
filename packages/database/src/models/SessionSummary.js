import { Schema, model } from 'mongoose';

/**
 * SessionSummary — post-call LLM analizi sonucu.
 * worker-general'daki analyze-session handler tarafından üretilir.
 *
 * @see phase4_analytics_insights.md — Data model additions
 */
const SessionSummarySchema = new Schema(
    {
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
            unique: true,
            index: true
        },
        /** Kısa özet (TL;DR). */
        tldr: { type: String },
        /** Konuşmada geçen ana konular. */
        topics: { type: [String], default: [] },
        /** Ziyaretçinin dile getirdiği itirazlar. */
        objections: { type: [String], default: [] },
        /** KB'nin cevaplayamadığı sorular (knowledge gap). */
        unanswered: { type: [String], default: [] },
        /** Duygu analizi. */
        sentiment: {
            /** Genel duygu skoru: positive | neutral | negative */
            overall: { type: String, enum: ['positive', 'neutral', 'negative'] },
            /** Tur bazlı duygu bilgisi [{turn, sentiment}] */
            perTurn: { type: [Schema.Types.Mixed], default: [] }
        },
        /** Ziyaretçinin çıkmadan önceki son mesaj indeksi (drop-off point). */
        dropOff: { type: Number },
        /** Önerilen sonraki adım (ör. "Schedule a demo", "Send pricing"). */
        nextStep: { type: String },
        /** Özetin üretildiği zaman. */
        generatedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

export const SessionSummary = model('SessionSummary', SessionSummarySchema);
