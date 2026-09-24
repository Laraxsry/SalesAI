import { describe, expect, it } from 'vitest';
import { aggregateAdaptiveSurveyShadowReports } from './adaptive-survey-shadow-report.js';

describe('adaptive survey shadow report', () => {
    it('deduplicates sessions and never treats candidates as rollout approval', () => {
        const report = { sessionId: 'session-a', adaptiveSurveyShadow: {
            observations: 2, statuses: {
                unknown_field_candidate: 1, already_known: 1
            }, proposals: 1, proposalStatuses: { approved: 1 }
        } };
        expect(aggregateAdaptiveSurveyShadowReports([
            report, report, { sessionId: 'session-b', adaptiveSurveyShadow: {
                observations: 1, statuses: { unknown_field_candidate: 1 },
                proposals: 1, proposalStatuses: { rejected: 1 }
            } }
        ])).toMatchObject({ sessions: 2, observations: 3, proposals: 2,
            statuses: { unknown_field_candidate: 2, already_known: 1 },
            proposalStatuses: { approved: 1, rejected: 1 } });
    });
});
