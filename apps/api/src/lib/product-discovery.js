import { ProductDiscoveryInput } from '@repo/contracts';

const FIELD_CATALOG = Object.freeze({
    industry: {
        key: 'company.industry', affects: ['demo_route', 'pricing'],
        preferredInput: 'single_select'
    },
    teamSize: {
        key: 'company.team_size', affects: ['qualification'],
        preferredInput: 'single_select'
    },
    primaryGoal: {
        key: 'customer.primary_goal', affects: ['demo_route'],
        preferredInput: 'short_text'
    }
});

/** Compile simple authoring choices into the only runtime fields we permit. */
export function compileProductDiscovery(input) {
    const authoring = ProductDiscoveryInput.parse(input);
    return {
        enabled: authoring.enabled,
        policy: { enabled: authoring.enabled },
        fields: Object.entries(FIELD_CATALOG)
            .filter(([name]) => authoring.priorities[name] !== 'off')
            .map(([name, definition]) => ({
                ...definition,
                importance: authoring.priorities[name] === 'important' ? 'required' : 'recommended'
            }))
    };
}

/** Never expose the raw runtime policy in the console's authoring model. */
export function projectProductDiscovery(stored) {
    const priorities = { industry: 'off', teamSize: 'off', primaryGoal: 'off' };
    for (const [name, definition] of Object.entries(FIELD_CATALOG)) {
        const field = stored?.fields?.find((candidate) => candidate.key === definition.key);
        if (field) priorities[name] = field.importance === 'required' ? 'important' : 'helpful';
    }
    return { enabled: stored?.enabled === true, priorities };
}
