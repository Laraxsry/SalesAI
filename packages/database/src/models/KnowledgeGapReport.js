import { Schema, model } from 'mongoose';

/**
 * KnowledgeGapReport — bir ürünün TÜM knowledge kaynaklarını LLM ile
 * karşılaştırıp tutarsızlık/yetersiz-detay/eksik-konu bulguları üreten,
 * kullanıcı tarafından (Console'dan) manuel tetiklenen analiz sonucu.
 *
 * `apps/worker-general/src/handlers/analyze-knowledge-gaps.js` tarafından
 * doldurulur. `GET /analytics/knowledge-gaps` (SessionSummary.unanswered
 * aggregation'ı) ile KARIŞTIRILMAMALI — o reaktif (gerçek ziyaretçi
 * sorularından), bu proaktif (sadece knowledge içeriğinin kendisinden).
 *
 * @see md/backend/phase4_analytics_insights.md
 */
const KnowledgeGapReportSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
        error: { type: String },
        /** Analiz edilen kaynak sayısı — şeffaflık için (kullanıcı raporun kapsamını görebilsin). */
        sourceCount: { type: Number, default: 0 },
        /** MAX_GAP_ANALYSIS_SOURCES aşıldığı ve bazı kaynakların analize dahil edilmediği durumda true. */
        truncated: { type: Boolean, default: false },
        findings: {
            type: [
                {
                    type: { type: String, enum: ['inconsistency', 'thin', 'missing'], required: true },
                    title: { type: String, required: true },
                    description: { type: String, required: true },
                    // 'missing' bulguları hiçbir kaynakta yok demek olduğu için boş olabilir.
                    sourceIds: { type: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeSource' }], default: [] }
                }
            ],
            default: []
        }
    },
    { timestamps: true }
);

export const KnowledgeGapReport = model('KnowledgeGapReport', KnowledgeGapReportSchema);
