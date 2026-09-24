/** Parse an opt-in environment flag without accepting ambiguous truthy text. */
export function isEnabledFeatureFlag(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}
