import { describe, expect, it } from 'vitest';
import { buildSemanticCalibrationReport } from './semantic-calibration.js';

function report(sessionId, { trusted = true, coverage = 1, precision = 0.5 } = {}) {
    return {
        sessionId,
        shadowComparison: {
            semanticComparisonAvailable: true,
            semanticComparisonTrusted: trusted,
            semanticSources: { dynamic: [trusted ? 'semantic_resolver' : 'knowledge_intent'] },
            topics: {
                legacyCoverage: coverage,
                dynamicPrecision: precision,
                jaccard: 0.5,
                legacyOnly: coverage === 1 ? [] : ['topic:legacy:missed'],
                dynamicOnly: precision === 1 ? [] : ['topic:dynamic:new']
            },
            claims: { legacyCoverage: coverage }
        }
    };
}

describe('semantic calibration', () => {
    it('builds distributions and a bounded human review queue', () => {
        const calibration = buildSemanticCalibrationReport([
            report('session:anon:1'),
            report('session:anon:2', { trusted: false, coverage: 0, precision: 0 })
        ], { minimumComparableSessions: 2, minimumTrustedSessions: 1 });

        expect(calibration.sessions).toMatchObject({ total: 2, comparable: 2, trusted: 1 });
        expect(calibration.trustedDistributions.topicLegacyCoverage)
            .toMatchObject({ samples: 1, average: 1, p50: 1 });
        expect(calibration.dynamicSemanticSourceSessions).toEqual({
            semantic_resolver: 1,
            knowledge_intent: 1
        });
        expect(calibration.reviewQueue).toHaveLength(2);
        expect(calibration.thresholdSelectionReady).toBe(true);
    });

    it('does not recommend threshold selection from a tiny corpus', () => {
        const calibration = buildSemanticCalibrationReport([report('session:anon:1')]);
        expect(calibration.thresholdSelectionReady).toBe(false);
        expect(calibration.blockers).toEqual([
            'insufficient_comparable_sessions',
            'insufficient_trusted_sessions'
        ]);
    });
});
