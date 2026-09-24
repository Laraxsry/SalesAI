import { DiscoveryFieldDefinitionInput, SurveyPolicyInput } from '@repo/contracts';

/** Trusted product configuration; invalid or absent authoring fails closed. */
export function resolveAdaptiveSurveyConfig(raw, featureEnabled) {
    if (!featureEnabled || raw?.enabled !== true || !Array.isArray(raw.fields)) return null;
    const policy = SurveyPolicyInput.safeParse({ ...raw.policy, enabled: true });
    if (!policy.success || !policy.data.allowDynamicQuestions
        || policy.data.maxPerSession === 0) return null;
    const fields = raw.fields.map((field) => DiscoveryFieldDefinitionInput.safeParse(field));
    if (fields.length === 0 || fields.length > 20 || fields.some((field) => !field.success)) return null;
    const definitions = fields.map((field) => field.data);
    if (new Set(definitions.map((field) => field.key)).size !== definitions.length) return null;
    if (!definitions.some((field) => field.importance !== 'do_not_ask'
        && field.preferredInput !== 'voice' && field.affects.length > 0)) return null;
    return { policy: policy.data, fields: definitions };
}
