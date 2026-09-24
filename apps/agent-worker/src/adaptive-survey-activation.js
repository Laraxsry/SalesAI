/** Global kill-switch with product opt-in and session-level safety checks. */
export function decideAdaptiveSurveyActivation({
    featureEnabled = false,
    productConfigValid = false,
    rolloutDecision,
    maxParticipants = 1
}) {
    const reject = (reason) => ({ enabled: false, reason });
    if (!featureEnabled) return reject('feature_disabled');
    if (!productConfigValid) return reject('product_not_opted_in');
    if (rolloutDecision?.cohort !== 'canary'
        || rolloutDecision.dynamicStateEnabled !== true) return reject('not_canary');
    if (maxParticipants !== 1) return reject('group_session_unsupported');
    return { enabled: true, reason: 'enabled_for_active_session' };
}
