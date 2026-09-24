import { createDynamicPlaybookRolloutPolicy } from './dynamic-playbook-rollout-policy.js';
import { resolveAdaptiveSurveyConfig } from './adaptive-survey-config.js';
import { decideAdaptiveSurveyActivation } from './adaptive-survey-activation.js';

function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }

/** Simulates one proposed session. This cannot read or change live rollout state. */
export function evaluateAdaptiveSurveyPilotPreflight(plan, {
    operationalReadiness = null,
    humanReview = null,
    corpusScopeMatched = false
} = {}) {
    if (!plan || !['bootstrap', 'expand'].includes(plan.phase)
        || !nonempty(plan.sessionId) || !nonempty(plan.agentId)
        || !nonempty(plan.productId)
        || !Number.isInteger(plan.maxParticipants) || plan.maxParticipants < 1
        || !plan.dynamicRollout || !plan.survey) {
        throw new TypeError('invalid pilot simulation plan');
    }
    const configuredPercent = Number(plan.dynamicRollout.canaryPercent);
    if (!Number.isFinite(configuredPercent) || configuredPercent < 0 || configuredPercent > 100) {
        throw new TypeError('canaryPercent must be between 0 and 100');
    }
    const rollout = createDynamicPlaybookRolloutPolicy({
        mode: plan.dynamicRollout.mode,
        canaryPercent: configuredPercent
    }).decide({
        sessionId: plan.sessionId, agentId: plan.agentId, productId: plan.productId
    });
    const productConfig = resolveAdaptiveSurveyConfig(plan.productAdaptiveSurvey, true);
    const activation = decideAdaptiveSurveyActivation({
        featureEnabled: plan.survey.enabled === true,
        productConfigValid: Boolean(productConfig),
        rolloutDecision: rollout,
        maxParticipants: plan.maxParticipants
    });
    const checks = [
        { id: 'session_selected_for_canary', passed: rollout.cohort === 'canary',
            reason: rollout.reason },
        { id: 'survey_activation_eligible', passed: activation.enabled,
            reason: activation.reason }
    ];
    if (plan.phase === 'expand') {
        checks.push(
            { id: 'pilot_corpus_scope', passed: corpusScopeMatched === true,
                reason: corpusScopeMatched ? 'agent_product_scope_matched' : 'missing_or_mismatched' },
            { id: 'operational_evidence',
                passed: operationalReadiness?.operationalChecksPassed === true,
                reason: operationalReadiness ? 'evaluated' : 'missing' },
            { id: 'human_review_evidence',
                passed: humanReview?.checksPassed === true,
                reason: humanReview ? 'evaluated' : 'missing' }
        );
    }
    return {
        phase: plan.phase,
        simulationOnly: true,
        checksPassed: checks.every((check) => check.passed),
        rolloutAuthorized: false,
        checks,
        blockers: checks.filter((check) => !check.passed).map((check) => check.id),
        observedCohort: rollout.cohort,
        canaryPercent: configuredPercent,
        configuredFieldCount: productConfig?.fields.length ?? 0,
        rollback: 'Set DYNAMIC_PLAYBOOK_ADAPTIVE_SURVEY_ENABLED=false for new sessions and restart workers.',
        note: 'This simulates supplied configuration for one session ID. Verify deployed settings and obtain explicit human approval before any live change.'
    };
}
