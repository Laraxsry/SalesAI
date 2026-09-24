function normalizeAnswer(proposal, value, skipped) {
    if (skipped) return { ok: true, skipped: true, value: null, label: null };
    if (proposal.answerType === 'single_select') {
        const option = proposal.options.find((candidate) => candidate.value === value);
        return option
            ? { ok: true, skipped: false, value: option.value, label: option.label }
            : { ok: false, reason: 'invalid_option' };
    }
    if (proposal.answerType === 'multi_select') {
        const values = Array.isArray(value) ? [...new Set(value.map(String))].slice(0, 6) : [];
        const allowed = new Map(proposal.options.map((option) => [option.value, option.label]));
        if (values.length === 0 || values.some((item) => !allowed.has(item))) {
            return { ok: false, reason: 'invalid_options' };
        }
        return {
            ok: true, skipped: false, value: values,
            label: values.map((item) => allowed.get(item)).join(', ')
        };
    }
    if (proposal.answerType === 'number') {
        if (value === null || value === undefined || String(value).trim() === '') {
            return { ok: false, reason: 'answer_required' };
        }
        const number = Number(value);
        return Number.isFinite(number)
            ? { ok: true, skipped: false, value: number, label: String(number) }
            : { ok: false, reason: 'invalid_number' };
    }
    const text = String(value ?? '').trim().slice(0, 1000);
    return text
        ? { ok: true, skipped: false, value: text, label: text }
        : { ok: false, reason: 'answer_required' };
}

function visitorPayload(proposal, ttlMs, now) {
    return {
        type: 'salesai:survey',
        action: 'show',
        mode: 'adaptive',
        nodeId: proposal.proposalId,
        surveyId: proposal.proposalId,
        proposalId: proposal.proposalId,
        questionKey: proposal.questionKey,
        question: proposal.question,
        answerType: proposal.answerType,
        options: proposal.options,
        allowFreeText: proposal.answerType === 'short_text',
        required: false,
        expiresAt: now() + ttlMs
    };
}

/** Owns adaptive survey presentation, answer persistence, cleanup and replan signals. */
export function createAdaptiveSurveyRuntime({
    store,
    publish,
    persistAnswer,
    acknowledge = async () => {},
    replan = async () => {},
    onEvent = () => {},
    ttlMs = 30000,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (timer) => clearTimeout(timer)
}) {
    let expiryTimer = null;
    let processingAnswer = false;
    let activePayload = null;

    function report(event, meta = {}) {
        try { onEvent(event, meta); } catch { /* telemetry is non-authoritative */ }
    }

    function clearExpiry() {
        if (expiryTimer !== null) clearTimer(expiryTimer);
        expiryTimer = null;
    }

    function expireWhenIdle(proposalId) {
        if (processingAnswer) {
            expiryTimer = setTimer(() => expireWhenIdle(proposalId), 1000);
            return;
        }
        void close(proposalId, 'expired', 'expired');
    }

    async function hide(proposalId, reason) {
        await publish({
            type: 'salesai:survey', action: 'hide', mode: 'adaptive',
            nodeId: proposalId, surveyId: proposalId, reason
        }).catch(() => {});
    }

    async function close(proposalId, reason, questionStatus = null) {
        const state = store.snapshot();
        if (state.adaptiveSurvey.activeSurveyId !== proposalId) {
            return { ok: false, reason: 'survey_not_active' };
        }
        clearExpiry();
        activePayload = null;
        if (questionStatus) {
            const proposal = state.adaptiveSurvey.approvedProposal;
            store.dispatch({
                type: 'QUESTION_RECORDED',
                question: {
                    questionKey: proposal.questionKey,
                    channel: 'survey',
                    status: questionStatus
                }
            });
        }
        store.dispatch({ type: 'ADAPTIVE_SURVEY_CLOSED', proposalId, reason });
        await hide(proposalId, reason);
        report(reason, { proposalId });
        return { ok: true, status: reason };
    }

    return {
        activePayload() {
            const activeId = store.snapshot().adaptiveSurvey.activeSurveyId;
            return activeId && activePayload?.nodeId === activeId ? activePayload : null;
        },

        isActive(proposalId) {
            return Boolean(proposalId)
                && store.snapshot().adaptiveSurvey.activeSurveyId === proposalId;
        },

        async presentApproved() {
            const state = store.snapshot();
            const proposal = state.adaptiveSurvey.approvedProposal;
            if (!proposal) return { ok: false, reason: 'no_approved_proposal' };
            if (state.adaptiveSurvey.activeSurveyId) {
                return { ok: false, reason: 'another_survey_active' };
            }
            store.dispatch({ type: 'ADAPTIVE_SURVEY_OPENED', proposalId: proposal.proposalId });
            if (store.snapshot().adaptiveSurvey.activeSurveyId !== proposal.proposalId) {
                return { ok: false, reason: 'open_rejected_by_reducer' };
            }
            try {
                const payload = visitorPayload(proposal, ttlMs, now);
                await publish(payload);
                activePayload = payload;
            } catch {
                store.dispatch({
                    type: 'ADAPTIVE_SURVEY_CLOSED',
                    proposalId: proposal.proposalId,
                    reason: 'publish_failed'
                });
                report('publish_failed', { proposalId: proposal.proposalId });
                return { ok: false, reason: 'publish_failed' };
            }
            store.dispatch({
                type: 'QUESTION_RECORDED',
                question: {
                    questionKey: proposal.questionKey,
                    channel: 'survey',
                    status: 'asked'
                }
            });
            clearExpiry();
            expiryTimer = setTimer(() => expireWhenIdle(proposal.proposalId), ttlMs);
            report('opened', {
                proposalId: proposal.proposalId,
                questionKey: proposal.questionKey,
                answerType: proposal.answerType,
                expiresInMs: ttlMs
            });
            return { ok: true, proposalId: proposal.proposalId };
        },

        async answer({ proposalId, answerId, value, skipped = false }) {
            if (processingAnswer) return { ok: false, reason: 'answer_in_progress' };
            const state = store.snapshot();
            if (state.adaptiveSurvey.activeSurveyId !== proposalId) {
                return { ok: false, reason: 'survey_not_active' };
            }
            const proposal = state.adaptiveSurvey.approvedProposal;
            const normalized = normalizeAnswer(proposal, value, skipped);
            if (!normalized.ok) return normalized;
            if (!answerId || typeof answerId !== 'string') {
                return { ok: false, reason: 'missing_answer_id' };
            }

            const record = {
                answerId,
                nodeId: proposalId,
                proposalId,
                adaptive: true,
                fieldKey: proposal.questionKey,
                question: proposal.question,
                answer: normalized.label,
                answerValue: normalized.value,
                skipped: normalized.skipped,
                answeredAt: new Date(now())
            };
            processingAnswer = true;
            let persisted;
            try {
                persisted = await persistAnswer(record);
            } catch {
                processingAnswer = false;
                report('persistence_failed', { proposalId });
                return { ok: false, reason: 'persistence_failed' };
            }
            processingAnswer = false;
            if (persisted?.ok === false) {
                report('persistence_failed', { proposalId });
                return { ok: false, reason: 'persistence_failed' };
            }
            if (store.snapshot().adaptiveSurvey.activeSurveyId !== proposalId) {
                return { ok: false, reason: 'survey_no_longer_active' };
            }

            clearExpiry();
            store.dispatch({
                type: 'QUESTION_RECORDED',
                question: {
                    questionKey: proposal.questionKey,
                    channel: 'survey',
                    status: normalized.skipped ? 'dismissed' : 'answered',
                    answerRef: normalized.skipped ? null : `survey_answer:${answerId || proposalId}`
                }
            });
            if (!normalized.skipped) {
                store.dispatch({
                    type: 'FACT_DISCOVERED',
                    fact: {
                        key: proposal.questionKey,
                        value: normalized.value,
                        source: 'survey',
                        confidence: 1,
                        evidenceRef: `survey_answer:${answerId || proposalId}`
                    }
                });
            }
            store.dispatch({ type: 'ADAPTIVE_SURVEY_CLOSED', proposalId, reason: 'answered' });
            activePayload = null;
            await hide(proposalId, normalized.skipped ? 'dismissed' : 'answered');
            report(normalized.skipped ? 'dismissed' : 'answered', {
                proposalId,
                questionKey: proposal.questionKey,
                answerId: answerId ?? null,
                requiredFor: proposal.requiredFor
            });
            try {
                await acknowledge({ skipped: normalized.skipped, questionKey: proposal.questionKey });
            } catch {
                report('acknowledgement_failed', { proposalId });
            }
            if (!normalized.skipped) {
                Promise.resolve().then(() => replan({
                        reason: `survey_answer:${proposal.questionKey}`,
                        questionKey: proposal.questionKey,
                        requiredFor: proposal.requiredFor
                    })).catch(() => {
                    report('replan_failed', { proposalId });
                });
            }
            return { ok: true, skipped: normalized.skipped, duplicate: persisted?.duplicate === true };
        },

        dismiss(proposalId) {
            return close(proposalId, 'dismissed', 'dismissed');
        },

        cancel(reason = 'cancelled') {
            const proposalId = store.snapshot().adaptiveSurvey.activeSurveyId;
            if (processingAnswer) return Promise.resolve({ ok: false, reason: 'answer_in_progress' });
            return proposalId
                ? close(proposalId, reason, reason === 'expired' ? 'expired' : 'cancelled')
                : Promise.resolve({ ok: false, reason: 'survey_not_active' });
        },

        dispose() {
            clearExpiry();
            activePayload = null;
        }
    };
}
