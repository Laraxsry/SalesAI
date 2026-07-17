import { Session, Message, SessionSummary, Agent, Product, Workspace, Lead } from '@repo/database';
import { getLLM } from '@repo/ai';
import { publishEvent } from '@repo/realtime';
import { Logger } from '@repo/logger';
import { extractLead } from './extract-lead.js';

/** Tek bir konuşmada tutulacak maksimum mesaj sayısı (maliyet kontrolü). */
const MAX_MESSAGES_FOR_ANALYSIS = 60;

/**
 * Bir oturum bittikten sonra LLM ile post-call analizi yapar.
 * Sonucu SessionSummary olarak kalıcı hâle getirir ve Socket.IO'ya yayar.
 *
 * Mimarı Not:
 *  - Ucuz model kullanılır (gpt-4o-mini) — 03_data_model_and_api.md Risks bölümü
 *  - Transcript cap: MAX_MESSAGES_FOR_ANALYSIS (maliyet kontrolü)
 *
 * @param {{ sessionId: string }} data
 */
export async function analyzeSession({ sessionId }) {
    Logger.info('[analyze-session] başlıyor', { sessionId });

    // ── 1. Session + mesajları yükle ───────────────────────────────────────────
    const session = await Session.findById(sessionId);
    if (!session) {
        Logger.warn('[analyze-session] session bulunamadı', { sessionId });
        return;
    }

    const messages = await Message.find({ sessionId: session._id })
        .sort({ at: 1 })
        .limit(MAX_MESSAGES_FOR_ANALYSIS)
        .lean();

    if (!messages.length) {
        Logger.info('[analyze-session] mesaj yok, özet atlanıyor', { sessionId });
        return;
    }

    // ── 2. Transcript metnini birleştir ────────────────────────────────────────
    const transcript = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role === 'user' ? 'Visitor' : 'Agent'}: ${m.text || ''}`)
        .join('\n');

    // ── 3. Drop-off noktasını bul (visitor'ın çıkmadan önceki son mesajı) ─────
    let dropOff = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { dropOff = i; break; }
    }

    // ── 4. LLM'e analiz yaptır ─────────────────────────────────────────────────
    const llm = getLLM();

    const systemPrompt = `You are an expert sales conversation analyst.
Analyze the following customer-agent conversation transcript and respond ONLY with valid JSON (no markdown, no explanation).

The JSON must follow this exact schema:
{
  "tldr": "string — 1-2 sentence TL;DR of the conversation",
  "topics": ["string array — main topics discussed"],
  "objections": ["string array — objections or concerns raised by the visitor"],
  "unanswered": ["string array — questions the agent could not answer from its knowledge base"],
  "sentiment": {
    "overall": "positive | neutral | negative",
    "perTurn": [{"turn": number, "role": "user|assistant", "sentiment": "positive|neutral|negative"}]
  },
  "nextStep": "string — recommended next action for the sales team"
}`;

    let analysis;
    try {
        const response = await llm.complete({
            model: 'gpt-4o-mini',
            system: systemPrompt,
            messages: [{ role: 'user', content: `TRANSCRIPT:\n${transcript}` }]
        });

        analysis = JSON.parse(response.text);
    } catch (err) {
        Logger.error('[analyze-session] LLM analizi başarısız', { sessionId, error: err?.message });
        // Analiz başarısız olsa da boş bir summary oluştur (başarısız durum kaydı)
        analysis = {
            tldr: '',
            topics: [],
            objections: [],
            unanswered: [],
            sentiment: { overall: 'neutral', perTurn: [] },
            nextStep: ''
        };
    }

    // ── 5. SessionSummary kaydet / güncelle ────────────────────────────────────
    const summary = await SessionSummary.findOneAndUpdate(
        { sessionId: session._id },
        {
            sessionId: session._id,
            tldr: analysis.tldr,
            topics: analysis.topics || [],
            objections: analysis.objections || [],
            unanswered: analysis.unanswered || [],
            sentiment: analysis.sentiment || { overall: 'neutral', perTurn: [] },
            dropOff,
            nextStep: analysis.nextStep,
            generatedAt: new Date()
        },
        { upsert: true, new: true }
    );

    Logger.info('[analyze-session] özet kaydedildi', { sessionId, summaryId: String(summary._id) });

    // ── 6. Session.summary alanını da güncelle (hızlı erişim için) ────────────
    await Session.updateOne({ _id: session._id }, {
        summary: {
            tldr: analysis.tldr,
            topics: analysis.topics,
            sentiment: analysis.sentiment?.overall
        }
    });

    // ── 7. Socket.IO event yayını — session:summary ────────────────────────────
    // 03_data_model_and_api.md Socket.IO events: session:summary S→C
    try {
        await publishEvent('session:summary', {
            sessionId,
            tldr: analysis.tldr,
            topics: analysis.topics,
            sentiment: analysis.sentiment?.overall
        });
    } catch (err) {
        Logger.warn('[analyze-session] publishEvent başarısız (non-fatal)', { error: err?.message });
    }

    // ── 8. Lead extraction ─────────────────────────────────────────────────────
    try {
        const agent = await Agent.findById(session.agentId).lean();
        if (agent) {
            const product = await Product.findById(agent.productId).lean();
            const workspaceId = product?.workspaceId;
            if (workspaceId) {
                await extractLead({ session, messages, analysis, workspaceId });
            }
        }
    } catch (err) {
        Logger.warn('[analyze-session] lead extraction başarısız (non-fatal)', { error: err?.message });
    }

    Logger.info('[analyze-session] tamamlandı', { sessionId });
}
