import {
    DiscoveryFieldDefinitionInput,
    KnownFactResolutionInput,
    SurveyPolicyInput,
    SurveyProposalInput
} from '@repo/contracts';

const ALWAYS_PROHIBITED_PARTS = new Set([
    'password', 'passcode', 'secret', 'token', 'cvv', 'payment_card',
    'card_number', 'government_id', 'ssn', 'tcno'
]);

function prohibitedField(key, prohibitedFields) {
    const normalizedKey = key.toLowerCase();
    const parts = normalizedKey.split(/[._-]/);
    return prohibitedFields.some((field) => {
        const normalizedField = field.toLowerCase();
        return normalizedKey === normalizedField || normalizedKey.startsWith(`${normalizedField}.`);
    })
        || parts.some((part) => ALWAYS_PROHIBITED_PARTS.has(part));
}

function decision(status, reason, extra = {}) {
    return { status, reason, ...extra };
}

/** Pure fail-closed authority boundary for adaptive discovery proposals. */
export function evaluateSurveyProposal({
    proposal,
    policy: policyInput = {},
    fieldDefinitions = [],
    factResolution,
    memory,
    runtime,
    hasOpenCustomerQuestion = false
}) {
    const parsedProposal = SurveyProposalInput.safeParse(proposal);
    if (!parsedProposal.success) return decision('rejected', 'invalid_proposal');
    const parsedPolicy = SurveyPolicyInput.safeParse(policyInput);
    if (!parsedPolicy.success) return decision('rejected', 'invalid_policy');
    const parsedFact = KnownFactResolutionInput.safeParse(factResolution);
    if (!parsedFact.success) return decision('deferred', 'fact_resolution_unavailable');
    const survey = parsedProposal.data;
    const policy = parsedPolicy.data;
    const definitions = fieldDefinitions
        .map((field) => DiscoveryFieldDefinitionInput.safeParse(field))
        .filter((result) => result.success)
        .map((result) => result.data);
    const field = definitions.find((definition) => definition.key === survey.questionKey) ?? null;

    if (!policy.enabled) return decision('rejected', 'survey_disabled');
    if (!policy.allowDynamicQuestions) return decision('rejected', 'dynamic_questions_disabled');
    if (!policy.allowedPurposes.includes(survey.purpose)) {
        return decision('rejected', 'purpose_not_allowed');
    }
    if (prohibitedField(survey.questionKey, policy.prohibitedFields)) {
        return decision('rejected', 'prohibited_field');
    }
    if (!field) return decision('rejected', 'field_not_allowlisted');
    if (survey.blocking && policy.defaultBlocking === false) {
        return decision('rejected', 'blocking_not_allowed');
    }
    if (field?.importance === 'do_not_ask') return decision('rejected', 'field_marked_do_not_ask');
    if (field && !survey.requiredFor.some((impact) => field.affects.includes(impact))) {
        return decision('rejected', 'field_route_impact_mismatch');
    }
    if (survey.baseRevision !== runtime.routeRevision) {
        return decision('rejected', 'stale_route_revision');
    }
    if (survey.epoch !== runtime.epoch) return decision('rejected', 'stale_survey_epoch');
    if (runtime.activeSurveyId) return decision('deferred', 'another_survey_active');
    if (parsedFact.data.key !== survey.questionKey) {
        return decision('deferred', 'fact_key_mismatch');
    }

    const prior = memory.askedQuestions?.[survey.questionKey];
    if (prior && prior.status !== 'cancelled') {
        return decision('rejected', `question_already_${prior.status}`);
    }
    if (runtime.shownCount >= policy.maxPerSession) {
        return decision('rejected', 'session_survey_limit');
    }
    if (runtime.lastSurveyTurn !== null
        && memory.turnIndex - runtime.lastSurveyTurn < policy.cooldownTurns) {
        return decision('deferred', 'survey_cooldown');
    }
    if (parsedFact.data.status === 'known') return decision('rejected', 'fact_already_known');
    if (parsedFact.data.status === 'declined') return decision('rejected', 'fact_previously_declined');
    if (parsedFact.data.status === 'unavailable') {
        return decision('deferred', 'fact_source_unavailable');
    }
    if (parsedFact.data.status === 'verify' || parsedFact.data.status === 'conflict') {
        return decision('verify_voice', parsedFact.data.status === 'conflict'
            ? 'clarify_conflicting_fact'
            : 'confirm_existing_fact', {
            questionKey: survey.questionKey,
            fact: parsedFact.data.fact
        });
    }
    if (survey.confidenceThatUnknown < policy.minUnknownConfidence) {
        return decision('deferred', 'unknown_confidence_too_low');
    }
    if (hasOpenCustomerQuestion) return decision('deferred', 'answer_first_required');

    const channel = field?.preferredInput === 'voice' ? 'voice' : 'survey';
    return decision('approved', 'policy_passed', {
        channel,
        proposal: survey
    });
}
