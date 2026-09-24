import { describe, expect, it } from 'vitest';
import { resolveEngagementActivation } from './engagement-activation.js';

describe('engagement activation', () => {
    const optedIn = {
        schemaVersion: 1,
        multiAgentAnalysisEnabled: true,
        participantMemoryEnabled: true,
        adaptiveSurveyEnabled: true,
        dynamicDemoEnabled: true,
        leadCaptureEnabled: true
    };

    it('keeps every capability off when global kill-switches are off', () => {
        expect(resolveEngagementActivation({ productSettings: optedIn })).toEqual({
            multiAgentAnalysis: false,
            participantMemory: false,
            adaptiveSurvey: false,
            dynamicDemo: false,
            leadCapture: false
        });
    });

    it('requires both global capability and product opt-in', () => {
        expect(resolveEngagementActivation({
            global: {
                multiAgentAnalysis: true,
                participantMemory: true,
                adaptiveSurvey: true,
                dynamicDemo: false,
                leadCapture: true
            },
            productSettings: optedIn
        })).toEqual({
            multiAgentAnalysis: true,
            participantMemory: true,
            adaptiveSurvey: true,
            dynamicDemo: false,
            leadCapture: true
        });
    });

    it('fails closed for missing or malformed product settings', () => {
        expect(resolveEngagementActivation({
            global: { multiAgentAnalysis: true },
            productSettings: { multiAgentAnalysisEnabled: 'yes' }
        }).multiAgentAnalysis).toBe(false);
    });
});
