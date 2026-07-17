import { Schema, model } from 'mongoose';

/**
 * SessionEvent — oturum içindeki ayrık olayların ham kaydı.
 * Funnel ve zaman-üzerinde-sahne metrikleri için hammadde.
 *
 * @see phase4_analytics_insights.md — Task 2: Event stream
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
         * Olay türü.
         * - session_started   : oturum başladı
         * - tool_called       : agent bir araç çağırdı
         * - tour_started      : rehberli tur başladı
         * - screen_shared     : ziyaretçi ekranını paylaştı
         * - handoff_requested : insan temsilcisine devir istendi
         * - session_ended     : oturum kapandı
         */
        type: {
            type: String,
            enum: [
                'session_started',
                'tool_called',
                'tour_started',
                'screen_shared',
                'handoff_requested',
                'session_ended'
            ],
            required: true,
            index: true
        },
        /** Olayın gerçekleştiği zaman. */
        at: { type: Date, default: Date.now, index: true },
        /** Olay türüne özgü ek veri (araç adı, ekran URL'i vb.). */
        meta: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

export const SessionEvent = model('SessionEvent', SessionEventSchema);
