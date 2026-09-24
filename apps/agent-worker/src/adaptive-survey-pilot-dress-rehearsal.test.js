import { describe, expect, it } from 'vitest';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { sanitizeReplaySession } from './replay-fixture-sanitizer.js';
import { createAdaptiveSurveyPilotScope } from './adaptive-survey-pilot-scope.js';
import { validateAdaptiveSurveyCorpus } from './adaptive-survey-corpus.js';
import { evaluateDynamicPlaybookTimeline } from './dynamic-playbook-eval.js';
import { aggregateAdaptiveSurveyReports, evaluateAdaptiveSurveyReadiness }
    from './adaptive-survey-readiness.js';
import { buildAdaptiveSurveyReviewQueue, evaluateAdaptiveSurveyHumanReview }
    from './adaptive-survey-human-review.js';
import { evaluateAdaptiveSurveyPilotPreflight } from './adaptive-survey-pilot-preflight.js';

const salt = 'synthetic-pilot-rehearsal-salt';
const agentId = 'agent-a';
const productId = 'product-a';
const pilotScope = createAdaptiveSurveyPilotScope({ agentId, productId, salt });

function fixture(index) {
    const opened = index < 10;
    const proposalId = `proposal-${index}`;
    const events = [
        { seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG,
            meta: { enabled: true, cohort: 'canary', configuredFieldCount: 1 } },
        { seq: 2, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION,
            meta: { proposalId, status: opened ? 'approved' : 'rejected',
                reason: opened ? 'policy_passed' : 'fact_already_known',
                reviewStatuses: [opened ? 'known_fact:passed' : 'known_fact:flagged'] } },
        ...(opened ? [
            { seq: 3, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
                meta: { proposalId, event: 'opened' } },
            { seq: 4, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
                meta: { proposalId, event: 'answered' } }
        ] : [])
    ];
    return {
        ...sanitizeReplaySession({ sessionId: `synthetic-session-${index}`, events }, { salt }),
        pilotScope
    };
}

const plan = {
    phase: 'expand', sessionId: 'synthetic-session-0', agentId, productId,
    maxParticipants: 1,
    productAdaptiveSurvey: {
        enabled: true, policy: { enabled: true },
        fields: [{ key: 'company.industry', importance: 'recommended',
            affects: ['demo_route'], preferredInput: 'single_select' }]
    },
    dynamicRollout: { mode: 'canary', canaryPercent: 100,
        agentIds: [agentId], productIds: [productId] },
    survey: { enabled: true, agentIds: [agentId], productIds: [productId] }
};

describe('synthetic adaptive survey pilot rehearsal', () => {
    it('connects anonymized evidence, human labels and scope without authorizing rollout', () => {
        const fixtures = Array.from({ length: 20 }, (_, index) => fixture(index));
        const corpus = { schemaVersion: 1, privacy: 'allowlist-projected-pseudonymous',
            fixtureCount: fixtures.length, pilotScope, fixtures };
        expect(validateAdaptiveSurveyCorpus(corpus)).toBe(fixtures);

        const queue = buildAdaptiveSurveyReviewQueue(fixtures);
        const annotations = {
            schemaVersion: 2, corpusHash: queue.corpusHash,
            labels: queue.items.map(({ fixtureId, proposalId, group }) => ({
                fixtureId, proposalId,
                verdict: group === 'opened' ? 'appropriate' : 'correctly_suppressed'
            })),
            sessionLabels: queue.sessionItems.map(({ fixtureId }) => ({
                fixtureId, verdict: 'no_missed_opportunity'
            }))
        };
        const reports = fixtures.map(({ fixtureId, events }) => ({
            sessionId: fixtureId, ...evaluateDynamicPlaybookTimeline(events)
        }));
        const aggregate = aggregateAdaptiveSurveyReports(reports);
        const operationalReadiness = evaluateAdaptiveSurveyReadiness(aggregate);
        const humanReview = evaluateAdaptiveSurveyHumanReview(queue, annotations);
        expect(aggregate).toMatchObject({ pilotSessions: 20, opened: 10,
            answered: 10, reviewerSignals: {
                'known_fact:passed': 10, 'known_fact:flagged': 10
            } });
        expect(operationalReadiness.operationalChecksPassed).toBe(true);
        expect(humanReview.checksPassed).toBe(true);

        const preflight = evaluateAdaptiveSurveyPilotPreflight(plan, {
            operationalReadiness, humanReview,
            corpusScopeMatched: corpus.pilotScope === createAdaptiveSurveyPilotScope({
                agentId: plan.agentId, productId: plan.productId, salt
            })
        });
        expect(preflight).toMatchObject({
            checksPassed: true, rolloutAuthorized: false, blockers: []
        });
        expect(evaluateAdaptiveSurveyPilotPreflight({ ...plan, productId: 'product-b' }, {
            operationalReadiness, humanReview, corpusScopeMatched: false
        }).blockers).toContain('pilot_corpus_scope');
    });
});
