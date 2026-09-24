import { createHmac } from 'node:crypto';

/** Stable pseudonymous binding between a pilot plan and its exported corpus. */
export function createAdaptiveSurveyPilotScope({ agentId, productId, salt }) {
    if (typeof agentId !== 'string' || !agentId.trim()
        || typeof productId !== 'string' || !productId.trim()
        || typeof salt !== 'string' || salt.length < 16) {
        throw new TypeError('pilot scope requires agent, product and anonymization salt');
    }
    const digest = createHmac('sha256', salt)
        .update(JSON.stringify(['adaptive_survey_pilot_v1', agentId.trim(), productId.trim()]))
        .digest('hex')
        .slice(0, 32);
    return `pilot_scope:anon:${digest}`;
}
