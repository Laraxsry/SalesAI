import { describe, expect, it } from 'vitest';
import {
    compileProductEngagementSettings,
    projectProductEngagementSettings
} from './product-engagement.js';

describe('product engagement settings', () => {
    it('compiles safe disabled defaults for existing products', () => {
        expect(projectProductEngagementSettings(null)).toMatchObject({
            multiAgentAnalysisEnabled: false,
            participantMemoryEnabled: false,
            adaptiveSurveyEnabled: false,
            dynamicDemoEnabled: false,
            leadCaptureEnabled: false,
            scheduling: { enabled: false, timezone: 'UTC', durationMinutes: 30 }
        });
    });

    it('validates and version-pins product opt-in', () => {
        const compiled = compileProductEngagementSettings({
            multiAgentAnalysisEnabled: true,
            participantMemoryEnabled: true,
            captureFields: { email: 'required_before_close' },
            scheduling: { enabled: true, timezone: 'Europe/Brussels', durationMinutes: 45 }
        });

        expect(compiled).toMatchObject({
            schemaVersion: 1,
            multiAgentAnalysisEnabled: true,
            participantMemoryEnabled: true,
            captureFields: { email: 'required_before_close' }
        });
    });

    it('rejects unknown settings and invalid timezones', () => {
        expect(() => compileProductEngagementSettings({ unknown: true })).toThrow();
        expect(() => compileProductEngagementSettings({
            scheduling: { enabled: true, timezone: 'Brussels-ish', durationMinutes: 30 }
        })).toThrow();
    });
});
