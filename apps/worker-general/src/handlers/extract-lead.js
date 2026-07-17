import { Lead } from '@repo/database';
import { publishEvent } from '@repo/realtime';
import { Logger } from '@repo/logger';

/**
 * Kural tabanlı lead extraction ve scoring.
 *
 * Skor tablosu (toplam 0-100):
 *   email paylaşıldı      → +20
 *   demo intent           → +30
 *   tour_completed        → +30 (signals'dan)
 *   duration > 2dk        → +20
 *
 * @param {{
 *   session: object,
 *   messages: object[],
 *   analysis: { unanswered: string[], topics: string[], objections: string[] },
 *   workspaceId: import('mongoose').Types.ObjectId
 * }} params
 */
export async function extractLead({ session, messages, analysis, workspaceId }) {
    const signals = [];
    let score = 0;

    // ── 1. Email tespiti ────────────────────────────────────────────────────────
    const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
    const transcript = messages.map(m => m.text || '').join(' ');

    const emailMatch = transcript.match(EMAIL_REGEX);
    const email = emailMatch ? emailMatch[0].toLowerCase() : null;
    if (email) {
        signals.push({ type: 'email_shared', value: email, weight: 20 });
        score += 20;
    }

    // ── 2. Demo / pricing intent tespiti ───────────────────────────────────────
    const DEMO_KEYWORDS = ['demo', 'book a demo', 'schedule', 'pricing', 'price', 'cost', 'buy', 'purchase', 'trial', 'sign up'];
    const hasDemoIntent = DEMO_KEYWORDS.some(kw =>
        transcript.toLowerCase().includes(kw)
    );
    if (hasDemoIntent) {
        signals.push({ type: 'demo_intent', value: true, weight: 30 });
        score += 30;
    }

    // ── 3. Tur tamamlama sinyali (SessionEvent'ten veya messages.meta'dan) ─────
    const tourCompleted = messages.some(
        m => m.meta?.type === 'tour_started' || m.meta?.type === 'navigate_to'
    );
    if (tourCompleted) {
        signals.push({ type: 'tour_completed', value: true, weight: 30 });
        score += 30;
    }

    // ── 4. Süre kontrolü (>2 dakika) ───────────────────────────────────────────
    const durationMs = session.endedAt && session.startedAt
        ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
        : 0;
    const durationMin = durationMs / (1000 * 60);
    if (durationMin > 2) {
        signals.push({ type: 'long_session', value: Math.round(durationMin), weight: 20 });
        score += 20;
    }

    // ── 5. Company tespiti (konuşmadan basit regex) ────────────────────────────
    const COMPANY_REGEX = /(?:from|at|work(?:ing)? (?:at|for)|company[:\s]+)([\w\s&.'-]{2,40})/i;
    const companyMatch = transcript.match(COMPANY_REGEX);
    const company = companyMatch ? companyMatch[1].trim() : null;

    // ── 6. Skoru 100 ile sınırla ───────────────────────────────────────────────
    score = Math.min(score, 100);

    // Anlamlı bir sinyal yoksa lead oluşturma
    if (signals.length === 0) {
        Logger.info('[extract-lead] anlamlı sinyal yok, lead oluşturulmadı', {
            sessionId: String(session._id)
        });
        return null;
    }

    // ── 7. Lead kaydet / güncelle ──────────────────────────────────────────────
    const lead = await Lead.findOneAndUpdate(
        { sessionId: session._id },
        {
            sessionId: session._id,
            workspaceId,
            agentId: session.agentId,
            contact: {
                email: email || undefined,
                company: company || undefined,
                name: session.visitorName || undefined
            },
            score,
            status: score >= 50 ? 'qualified' : 'new',
            signals
        },
        { upsert: true, new: true }
    );

    Logger.info('[extract-lead] lead kaydedildi', {
        sessionId: String(session._id),
        leadId: String(lead._id),
        score
    });

    // ── 8. Socket.IO event yayını — lead:captured ──────────────────────────────
    // 03_data_model_and_api.md Socket.IO events: lead:created S→C
    try {
        await publishEvent('lead:captured', {
            leadId: String(lead._id),
            sessionId: String(session._id),
            score
        });
    } catch (err) {
        Logger.warn('[extract-lead] publishEvent başarısız (non-fatal)', { error: err?.message });
    }

    return lead;
}
