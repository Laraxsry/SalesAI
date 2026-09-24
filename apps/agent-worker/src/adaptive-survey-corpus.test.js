import { describe, expect, it } from 'vitest';
import { sanitizeReplaySession } from './replay-fixture-sanitizer.js';
import { validateAdaptiveSurveyCorpus } from './adaptive-survey-corpus.js';
import { TIMELINE_EVENTS } from './session-timeline.js';

const salt = 'corpus-validation-test-salt';

function corpus() {
    const fixture = sanitizeReplaySession({
        sessionId: 'session-a',
        events: [{ seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG,
            meta: { enabled: true, cohort: 'canary' } }]
    }, { salt });
    return { schemaVersion: 1, privacy: 'allowlist-projected-pseudonymous',
        fixtureCount: 1, fixtures: [fixture] };
}

describe('adaptive survey corpus contract', () => {
    it('accepts a sanitizer-produced corpus without changing its fixtures', () => {
        const input = corpus();
        expect(validateAdaptiveSurveyCorpus(input)).toBe(input.fixtures);
    });

    it('rejects inconsistent envelopes and duplicate sessions', () => {
        const input = corpus();
        expect(() => validateAdaptiveSurveyCorpus({ ...input, fixtureCount: 2 }))
            .toThrow(/corpus/);
        expect(() => validateAdaptiveSurveyCorpus({ ...input, privacy: 'raw' }))
            .toThrow(/corpus/);
        expect(() => validateAdaptiveSurveyCorpus({ ...input, fixtureCount: 2,
            fixtures: [...input.fixtures, structuredClone(input.fixtures[0])] }))
            .toThrow(/fixture/);
    });

    it('rejects missing privacy guarantees and malformed timelines', () => {
        const input = corpus();
        input.fixtures[0].privacy.freeTextRemoved = false;
        expect(() => validateAdaptiveSurveyCorpus(input)).toThrow(/fixture/);
        input.fixtures[0].privacy.freeTextRemoved = true;
        input.fixtures[0].events[0].seq = 99;
        expect(() => validateAdaptiveSurveyCorpus(input)).toThrow(/fixture/);
    });

    it('requires every fixture to carry the same pseudonymous pilot scope', () => {
        const input = corpus();
        input.pilotScope = 'pilot_scope:anon:0123456789abcdef0123456789abcdef';
        expect(() => validateAdaptiveSurveyCorpus(input)).toThrow(/fixture/);
        input.fixtures[0].pilotScope = input.pilotScope;
        expect(validateAdaptiveSurveyCorpus(input)).toBe(input.fixtures);
        input.fixtures[0].pilotScope = 'pilot_scope:anon:ffffffffffffffffffffffffffffffff';
        expect(() => validateAdaptiveSurveyCorpus(input)).toThrow(/fixture/);
    });
});
