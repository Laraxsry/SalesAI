import {
    ProductEngagementSettingsInput,
    ProductEngagementSettingsRuntimeInput
} from '@repo/contracts';

export function compileProductEngagementSettings(input) {
    return ProductEngagementSettingsRuntimeInput.parse({
        ...ProductEngagementSettingsInput.parse(input),
        schemaVersion: 1
    });
}

export function projectProductEngagementSettings(stored) {
    const parsed = ProductEngagementSettingsRuntimeInput.safeParse(stored);
    const value = parsed.success
        ? parsed.data
        : ProductEngagementSettingsRuntimeInput.parse({});
    const authoring = { ...value };
    delete authoring.schemaVersion;
    return authoring;
}
