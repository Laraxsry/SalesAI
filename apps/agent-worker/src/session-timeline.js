/**
 * Bir oturumun uçtan uca kronolojik kaydı.
 *
 * Var oluş sebebi doğrudan bir hata ayıklama deneyimi: canlı bir seansta ne
 * olduğunu anlamak, terminal logunu elle okuyup DB'deki mesajlarla zaman
 * damgası eşleştirmeyi gerektiriyordu — ve iki kaynak da tek başına
 * eksikti. Log'da ziyaretçinin mikrofonu ne zaman açtığı yok; DB'de
 * Playwright'ın arka planda ne yaptığı yok; hiçbirinde modelin "dinliyor →
 * düşünüyor → konuşuyor" geçişleri yok. Bu modül üçünü de tek, sıralı bir
 * akışa yazar.
 *
 * *** ASLA PATLAMAZ — BU BİR KONFOR DEĞİL, KURAL ***
 * Buradaki hiçbir çağrı, çağıran akışı bozamaz. İzleme, izlediği şeyi
 * çökertirse izleme değildir: canlı bir görüşmenin ortasında DB yazımı
 * başarısız olduğu için oturumun düşmesi, hiç log tutmamaktan kötüdür.
 * `emit` senkron ve void; kalıcılaştırma ateşle-unut, hatası yutuluyor.
 *
 * Saf ve enjekte edilebilir (silence-driver.js ile aynı desen): DB'yi ya da
 * logger'ı doğrudan import etmez, ikisi de dışarıdan verilir — testler
 * gerçek bir Mongo bağlantısı olmadan tüm davranışı doğrulayabilsin diye.
 */

/**
 * Olay sözlüğü — SessionEvent.type'ın tek geçerli kaynağı (şemada enum yok,
 * bkz. oradaki yorum). Noktalı ad: `alan.nesne.durum`.
 *
 * Adlandırma kuralı: süreli işlerde `.begin`/`.end` çifti, anlık olaylarda
 * tek ad. `.end` olayları `durationMs` taşır.
 */
export const TIMELINE_EVENTS = {
    // ── Oturum yaşam döngüsü ─────────────────────────────────────────────
    SESSION_START: 'session.start',
    SESSION_END: 'session.end',
    REALTIME_GATE_OPEN: 'session.realtime_gate.open',
    ERROR: 'session.error',

    // ── Runtime / browser seçimi ─────────────────────────────────────────
    BROWSER_PROVIDER_SELECTED: 'browser.provider.selected',

    // ── Katılımcı / medya ────────────────────────────────────────────────
    PARTICIPANT_JOIN: 'media.participant.join',
    PARTICIPANT_LEAVE: 'media.participant.leave',
    TRACK_SUBSCRIBED: 'media.track.subscribed',
    MIC_ON: 'media.mic.on',
    MIC_OFF: 'media.mic.off',
    AVATAR_READY: 'media.avatar.ready',
    AVATAR_FAILED: 'media.avatar.failed',

    // ── Konuşma durumu ───────────────────────────────────────────────────
    AGENT_STATE: 'speech.agent.state',
    USER_STATE: 'speech.user.state',
    TRANSCRIPT_AGENT: 'speech.transcript.agent',
    TRANSCRIPT_USER: 'speech.transcript.user',
    NUDGE_SENT: 'speech.nudge.sent',

    // ── Playbook ─────────────────────────────────────────────────────────
    PLAYBOOK_LOADED: 'playbook.loaded',
    PLAYBOOK_START: 'playbook.start',
    PLAYBOOK_NODE_ENTER: 'playbook.node.enter',
    PLAYBOOK_NODE_REDELIVER: 'playbook.node.redeliver',
    PLAYBOOK_NODE_EXIT: 'playbook.node.exit',
    PLAYBOOK_NODE_FAILED: 'playbook.node.failed',
    PLAYBOOK_ADVANCE_IGNORED: 'playbook.advance.ignored',
    // agent.js caught the SDK's own directive-less auto-follow-up (see
    // followup-guard.js) before it could speak, and asked the runtime to
    // redeliver the node it belongs to instead.
    PLAYBOOK_FOLLOWUP_SUPPRESSED: 'playbook.followup.suppressed',
    PLAYBOOK_COMPLETED: 'playbook.completed',
    SURVEY_SHOWN: 'survey.shown',
    SURVEY_ANSWERED: 'survey.answered',

    // ── Ekran / Playwright ───────────────────────────────────────────────
    TOUR_CHOREOGRAPHY: 'tour.choreography',
    TOUR_PRESENTATION_PUBLISH: 'tour.presentation.publish',
    TOUR_BROWSER_ACTION: 'tour.browser.action',
    SCREEN_NAVIGATE_BEGIN: 'screen.navigate.begin',
    SCREEN_NAVIGATE_END: 'screen.navigate.end',
    SCREEN_TOUR_PREPARE_BEGIN: 'screen.tour.prepare.begin',
    SCREEN_TOUR_PREPARE_END: 'screen.tour.prepare.end',
    SCREEN_TOUR_FRAME_SUBMITTED: 'screen.tour.frame.submitted',
    SCREEN_TOUR_FRAME_FAILED: 'screen.tour.frame.failed',
    SCREEN_TOUR_FRAME_STALE: 'screen.tour.frame.stale',
    SCREEN_TOUR_FRAME_SUPERSEDED: 'screen.tour.frame.superseded',
    SCREEN_TOUR_FRAME_ABANDONED: 'screen.tour.frame.abandoned',
    SCREEN_HIDE_BEGIN: 'screen.hide.begin',
    SCREEN_HIDE_END: 'screen.hide.end',
    SCREEN_TOUR_OPENED: 'screen.tour.opened',
    SCREEN_SHARE_START: 'screen.share.start',
    SCREEN_SHARE_END: 'screen.share.end',

    // ── Araçlar ──────────────────────────────────────────────────────────
    TOOL_BEGIN: 'tool.begin',
    TOOL_END: 'tool.end'
};

/**
 * @param {object} deps
 * @param {string} deps.sessionId
 * @param {{info: Function, warn: Function}} deps.log
 * @param {(doc: object) => Promise<unknown>} [deps.persist] tek bir olayı
 *   kalıcılaştırır (üretimde `SessionEvent.create`). Verilmezse olaylar
 *   yalnızca log'a gider — testler ve kalıcılaştırmanın istenmediği yollar
 *   için.
 * @param {() => number} [deps.now]
 */
export function createSessionTimeline({ sessionId, log, persist, now = () => Date.now() }) {
    const startedAt = now();
    let seq = 0;

    /**
     * @param {string} type TIMELINE_EVENTS'ten bir değer
     * @param {object} [meta]
     * @param {number} [durationMs]
     */
    function emit(type, meta = {}, durationMs) {
        try {
            seq += 1;
            const t = now() - startedAt;
            const at = new Date();

            // Log satırı `t` ve `seq` ile başlar: terminalde göz, tam olarak
            // DB'deki sıralamanın aynısını görsün diye — iki kaynağı elle
            // hizalamak zorunda kalmanın önüne geçen şey bu.
            log.info(`⏱ ${type}`, { seq, t, durationMs, ...meta });

            persist?.({
                sessionId,
                type,
                seq,
                t,
                at,
                ...(durationMs !== undefined ? { durationMs } : {}),
                meta
            })?.catch?.((err) => {
                // Yalnızca uyarı: kayıp bir izleme satırı, düşen bir
                // görüşmeden iyidir. Sessizce yutmuyoruz ki kalıcı bir DB
                // sorunu fark edilebilsin.
                log.warn('timeline persist failed (non-fatal)', { type, error: err.message });
            });
        } catch (err) {
            // Buraya normalde hiç düşülmemeli; düşülürse bile çağıranı
            // etkilememesi bu fonksiyonun tek sert kuralı.
            log.warn('timeline emit failed (non-fatal)', { type, error: err?.message });
        }
    }

    return {
        emit,

        /**
         * Süreli bir iş için `.begin` olayını hemen yazar; dönen fonksiyon
         * çağrıldığında `.end` olayını ölçülen süreyle yazar.
         *
         * `beginType`/`endType` ayrı ayrı veriliyor (tek bir ada `.begin`/
         * `.end` eklemek yerine) — sözlük TIMELINE_EVENTS'te açıkça dursun,
         * string birleştirmeyle üretilen ve hiçbir yerde aranamayan olay
         * adları oluşmasın diye.
         *
         * @returns {(extraMeta?: object) => void}
         */
        span(beginType, endType, meta = {}) {
            const spanStartedAt = now();
            emit(beginType, meta);
            let ended = false;
            return (extraMeta = {}) => {
                if (ended) return; // iki kez kapatmak sessizce yok sayılır
                ended = true;
                emit(endType, { ...meta, ...extraMeta }, now() - spanStartedAt);
            };
        },

        /** Test ve teşhis için: şu ana kadar kaç olay yazıldı. */
        get count() {
            return seq;
        }
    };
}

/**
 * Her tool çağrısının başlangıcını ve bitişini (süre + hata durumu ile)
 * zaman çizelgesine yazar.
 *
 * `withToolCallMetrics` ile ayrı tutuldu (SRP): o, Prometheus'a etiketli bir
 * süre gözlemi yazar ve oturumu bilmez; bu, oturuma özgü anlatıyı yazar ve
 * argümanları da kaydeder. İkisi serbestçe zincirlenebilir.
 *
 * Dönüş değerini ASLA değiştirmez — `advance_step`'in bilerek `undefined`
 * döndürmesi buna bağlı (bkz. packages/agent/src/tools.js).
 *
 * @param {Array<{name:string, handler:Function}>} toolDefs
 * @param {ReturnType<createSessionTimeline>} timeline
 */
export function withToolCallTimeline(toolDefs, timeline) {
    return toolDefs.map((toolDef) => ({
        ...toolDef,
        handler: async (...args) => {
            const end = timeline.span(TIMELINE_EVENTS.TOOL_BEGIN, TIMELINE_EVENTS.TOOL_END, {
                tool: toolDef.name,
                // İlk argüman modelin ürettiği parametre nesnesi. Neyi neden
                // çağırdığını sonradan anlamanın tek yolu bu — teşhiste en
                // çok işe yarayan alan.
                args: redactToolArgs(toolDef.name, args[0])
            });
            try {
                const result = await toolDef.handler(...args);
                end({ status: 'ok' });
                return result;
            } catch (err) {
                end({ status: 'error', error: err?.message });
                throw err;
            }
        }
    }));
}

function redactToolArgs(toolName, args) {
    if (!args || typeof args !== 'object') return args;
    if (toolName === 'browser_fill') return { ...args, value: '[REDACTED]' };
    if (toolName === 'browser_fill_form') {
        return {
            ...args,
            elements: Array.isArray(args.elements)
                ? args.elements.map((element) => ({ ...element, value: '[REDACTED]' }))
                : args.elements
        };
    }
    return args;
}
