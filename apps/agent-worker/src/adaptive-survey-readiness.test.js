import { describe, expect, it } from 'vitest';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { evaluateDynamicPlaybookTimeline } from './dynamic-playbook-eval.js';
import {
    aggregateAdaptiveSurveyReports, evaluateAdaptiveSurveyReadiness
} from './adaptive-survey-readiness.js';

function event(type, seq, meta) { return { type, seq, meta }; }

describe('adaptive survey canary evidence', () => {
    it('counts only enabled canary sessions and separates customer outcomes from failures', () => {
        const pilot = evaluateDynamicPlaybookTimeline([
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG, 1, {
                enabled: true, cohort: 'canary', configuredFieldCount: 2
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION, 2, {
                status: 'rejected', reason: 'fact_already_known',
                reviewStatuses: ['known_fact:flagged', 'conversation_timing:passed']
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE, 3, {
                event: 'opened', proposalId: 's1'
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE, 4, {
                event: 'answered', proposalId: 's1'
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE, 5, {
                event: 'publish_failed', proposalId: 's2'
            })
        ]);
        const control = evaluateDynamicPlaybookTimeline([
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG, 1, {
                enabled: false, cohort: 'shadow', configuredFieldCount: 0
            })
        ]);
        expect(aggregateAdaptiveSurveyReports([pilot, control])).toMatchObject({
            pilotSessions: 1, opened: 1, answered: 1, publishFailed: 1,
            answerRate: 1, publishFailureRate: 0.5, unclosedRate: 0,
            reviewerSignals: { 'known_fact:flagged': 1, 'conversation_timing:passed': 1 }
        });
    });

    it('stays fail-closed without samples and never authorizes expansion by itself', () => {
        const empty = evaluateAdaptiveSurveyReadiness(aggregateAdaptiveSurveyReports([]));
        expect(empty.operationalChecksPassed).toBe(false);
        expect(empty.blockers).toContain('minimum_pilot_sessions');
        const good = evaluateDynamicPlaybookTimeline([
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG, 1, {
                enabled: true, cohort: 'canary'
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE, 2, {
                event: 'opened', proposalId: 's1'
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE, 3, {
                event: 'answered', proposalId: 's1'
            })
        ]);
        const readiness = evaluateAdaptiveSurveyReadiness(
            aggregateAdaptiveSurveyReports(Array.from({ length: 20 }, () => good))
        );
        expect(readiness.operationalChecksPassed).toBe(true);
        expect(readiness.readyForWiderPilot).toBe(false);
        expect(readiness.requiresHumanReview).toBe(true);
    });

    it('does not inflate pilot evidence when a fixture is imported twice', () => {
        const report = {
            sessionId: 'same-session', adaptiveSurveyLifecycle: {
                pilotEnabled: true, opened: 1, answered: 1
            }
        };
        expect(aggregateAdaptiveSurveyReports([report, report]))
            .toMatchObject({ pilotSessions: 1, opened: 1 });
    });
});
