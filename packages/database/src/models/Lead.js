import { Schema, model } from 'mongoose';

/**
 * Lead — konuşmadan çıkarılan müşteri adayı.
 * extract-lead handler tarafından oluşturulur veya güncellenir.
 *
 * Score hesabı (kural tabanlı, 0-100):
 *   duration > 2dk    → +20
 *   tour_completed    → +30
 *   "demo" intent     → +30
 *   email paylaşıldı  → +20
 *
 * @see phase4_analytics_insights.md — Task 4: Lead capture & scoring
 */
const LeadSchema = new Schema(
    {
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'Session',
            required: true,
            unique: true,
            index: true
        },
        /** Hangi workspace'e ait (Agent → Product → Workspace zinciri). */
        workspaceId: {
            type: Schema.Types.ObjectId,
            ref: 'Workspace',
            required: true,
            index: true
        },
        /** Hangi agent'tan geldi. */
        agentId: {
            type: Schema.Types.ObjectId,
            ref: 'Agent',
            required: true,
            index: true
        },
        /** Konuşmadan çıkarılan iletişim bilgileri. */
        contact: {
            email:   { type: String },
            company: { type: String },
            name:    { type: String }
        },
        /** Toplam engagement skoru (0-100). */
        score: { type: Number, default: 0, min: 0, max: 100 },
        /** Lead durumu. */
        status: {
            type: String,
            enum: ['new', 'qualified', 'dismissed'],
            default: 'new',
            index: true
        },
        /**
         * Skoru oluşturan bireysel sinyaller.
         * Örnek: [{ type: 'demo_intent', value: true, weight: 30 }]
         */
        signals: { type: [Schema.Types.Mixed], default: [] }
    },
    { timestamps: true }
);

export const Lead = model('Lead', LeadSchema);
