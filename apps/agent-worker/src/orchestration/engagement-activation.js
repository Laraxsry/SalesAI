import { ProductEngagementSettingsRuntimeInput } from '@repo/contracts';

/** Global capability flags are kill-switches; product settings are daily opt-in. */
export function resolveEngagementActivation({ global = {}, productSettings } = {}) {
    const product = ProductEngagementSettingsRuntimeInput.safeParse(productSettings);
    const settings = product.success
        ? product.data
        : ProductEngagementSettingsRuntimeInput.parse({});

    return Object.freeze({
        multiAgentAnalysis: global.multiAgentAnalysis === true
            && settings.multiAgentAnalysisEnabled,
        participantMemory: global.participantMemory === true
            && settings.multiAgentAnalysisEnabled
            && settings.participantMemoryEnabled,
        adaptiveSurvey: global.adaptiveSurvey === true
            && settings.adaptiveSurveyEnabled,
        dynamicDemo: global.dynamicDemo === true
            && settings.dynamicDemoEnabled,
        leadCapture: global.leadCapture === true
            && settings.leadCaptureEnabled
    });
}
