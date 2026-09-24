import { describe, expect, it } from 'vitest';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { sanitizeReplaySession } from './replay-fixture-sanitizer.js';
import {
    buildAdaptiveSurveyReviewQueue,
    evaluateAdaptiveSurveyHumanReview
} from './adaptive-survey-human-review.js';

const salt = 'human-review-test-salt-long-enough';

function fixture(sessionId, { opened = true, cohort = 'canary', proposed = true } = {}) {
    return sanitizeReplaySession({
        sessionId,
        events: [
            { seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG,
                meta: { enabled: cohort === 'canary', cohort } },
            ...(proposed ? [{ seq: 2, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION,
                meta: { proposalId: `proposal-${sessionId}`,
                    status: opened ? 'approved' : 'rejected', reason: 'policy_passed',
                    question: 'Private question' } }] : []),
            ...(opened && proposed ? [
                { seq: 3, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
                    meta: { event: 'opened', proposalId: `proposal-${sessionId}`,
                        answer: 'secret answer' } },
                { seq: 4, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
                    meta: { event: 'answered', proposalId: `proposal-${sessionId}` } }
            ] : [])
        ]
    }, { salt });
}

describe('adaptive survey human review', () => {
    it('builds a privacy-only queue of opened and suppressed proposals', () => {
        const queue = buildAdaptiveSurveyReviewQueue([
            fixture('one'), fixture('two', { opened: false }), fixture('control', { cohort: 'shadow' })
        ]);
        expect(queue.items.map((item) => item.group).sort()).toEqual(['opened', 'suppressed']);
        expect(JSON.stringify(queue)).not.toMatch(/Private question|secret answer|proposal-one|proposal-two/);
        expect(queue.items.every((item) => item.fixtureId.startsWith('session:anon:'))).toBe(true);
    });

    it('requires exact corpus hash, known IDs and verdicts appropriate to the group', () => {
        const queue = buildAdaptiveSurveyReviewQueue([fixture('one')]);
        const item = queue.items[0];
        const base = { schemaVersion: 2, corpusHash: queue.corpusHash,
            labels: [{ fixtureId: item.fixtureId, proposalId: item.proposalId,
                verdict: 'appropriate' }], sessionLabels: [] };
        expect(() => evaluateAdaptiveSurveyHumanReview(queue, { ...base, corpusHash: 'stale' }))
            .toThrow(/do not match/);
        expect(() => evaluateAdaptiveSurveyHumanReview(queue, {
            ...base, labels: [...base.labels, ...base.labels]
        })).toThrow(/duplicate/);
        expect(() => evaluateAdaptiveSurveyHumanReview(queue, {
            ...base, labels: [{ ...base.labels[0], verdict: 'missed_opportunity' }]
        })).toThrow(/invalid verdict/);
        expect(() => evaluateAdaptiveSurveyHumanReview(queue, {
            ...base, labels: [{ ...base.labels[0], proposalId: 'unknown' }]
        })).toThrow(/unknown/);
    });

    it('reports false-positive and missed-opportunity signals without authorizing rollout', () => {
        const fixtures = [
            ...Array.from({ length: 10 }, (_, index) => fixture(`open-${index}`)),
            ...Array.from({ length: 10 }, (_, index) => fixture(`suppressed-${index}`, { opened: false }))
        ];
        const queue = buildAdaptiveSurveyReviewQueue(fixtures);
        const labels = queue.items.map((item) => ({
            fixtureId: item.fixtureId,
            proposalId: item.proposalId,
            verdict: item.group === 'opened' ? 'appropriate' : 'correctly_suppressed'
        }));
        const base = { schemaVersion: 2, corpusHash: queue.corpusHash, labels,
            sessionLabels: queue.sessionItems.map((item) => ({
                fixtureId: item.fixtureId, verdict: 'no_missed_opportunity'
            })) };
        const good = evaluateAdaptiveSurveyHumanReview(queue, base);
        expect(good).toMatchObject({ checksPassed: true, readyForWiderPilot: false,
            openedReviewed: 10, suppressedReviewed: 10 });
        let changedOpened = false;
        let changedSuppressed = false;
        const changed = labels.map((label) => {
            if (label.verdict === 'appropriate' && !changedOpened) {
                changedOpened = true;
                return { ...label, verdict: 'mistimed' };
            }
            if (label.verdict === 'correctly_suppressed' && !changedSuppressed) {
                changedSuppressed = true;
                return { ...label, verdict: 'missed_opportunity' };
            }
            return label;
        });
        const poor = evaluateAdaptiveSurveyHumanReview(queue, { ...base, labels: changed }, {
            maxUnnecessaryRate: 0, maxMissedOpportunityRate: 0
        });
        expect(poor.checksPassed).toBe(false);
        expect(poor.blockers).toContain('opening_issue_rate');
        expect(poor.blockers).toContain('missed_opportunity_rate');
    });

    it('rejects raw, non-anonymized replay documents', () => {
        expect(() => buildAdaptiveSurveyReviewQueue([{
            fixtureId: 'real-session', events: []
        }])).toThrow(/anonymized/);
    });

    it('invalidates labels when the source fixture changes', () => {
        const original = fixture('one');
        const changed = structuredClone(original);
        changed.events[1].meta.reason = 'fact_already_known';
        expect(buildAdaptiveSurveyReviewQueue([original]).corpusHash)
            .not.toBe(buildAdaptiveSurveyReviewQueue([changed]).corpusHash);
    });

    it('binds human labels to the pseudonymous pilot scope', () => {
        const original = fixture('one');
        const other = structuredClone(original);
        original.pilotScope = 'pilot_scope:anon:0123456789abcdef0123456789abcdef';
        other.pilotScope = 'pilot_scope:anon:ffffffffffffffffffffffffffffffff';
        expect(buildAdaptiveSurveyReviewQueue([original]).corpusHash)
            .not.toBe(buildAdaptiveSurveyReviewQueue([other]).corpusHash);
    });

    it('samples each outcome group and blocks cherry-picked partial labels', () => {
        const fixtures = [
            ...Array.from({ length: 30 }, (_, index) => fixture(`opened-${index}`)),
            ...Array.from({ length: 30 }, (_, index) => fixture(`blocked-${index}`, { opened: false }))
        ];
        const queue = buildAdaptiveSurveyReviewQueue(fixtures);
        expect(queue.candidateCount).toBe(60);
        expect(queue.items).toHaveLength(40);
        const labels = [
            ...queue.items.filter((item) => item.group === 'opened').slice(0, 10),
            ...queue.items.filter((item) => item.group === 'suppressed').slice(0, 10)
        ].map((item) => ({
            fixtureId: item.fixtureId, proposalId: item.proposalId,
            verdict: item.group === 'opened' ? 'appropriate' : 'correctly_suppressed'
        }));
        const result = evaluateAdaptiveSurveyHumanReview(queue, {
            schemaVersion: 2, corpusHash: queue.corpusHash, labels,
            sessionLabels: queue.sessionItems.map((item) => ({
                fixtureId: item.fixtureId, verdict: 'no_missed_opportunity'
            }))
        });
        expect(result.checksPassed).toBe(false);
        expect(result.blockers).toContain('opened_review_coverage');
        expect(result.blockers).toContain('suppressed_review_coverage');
    });

    it('samples pilot sessions even when the agent proposed no survey', () => {
        const queue = buildAdaptiveSurveyReviewQueue([
            fixture('none', { proposed: false }), fixture('one')
        ]);
        expect(queue.pilotSessionCount).toBe(2);
        expect(queue.items).toHaveLength(1);
        expect(queue.sessionItems).toHaveLength(2);
        const annotations = {
            schemaVersion: 2, corpusHash: queue.corpusHash,
            labels: [],
            sessionLabels: queue.sessionItems.map((item) => ({
                fixtureId: item.fixtureId,
                verdict: item.fixtureId === fixture('none', { proposed: false }).fixtureId
                    ? 'missed_opportunity' : 'no_missed_opportunity'
            }))
        };
        const result = evaluateAdaptiveSurveyHumanReview(queue, annotations, {
            minOpened: 0, minSuppressed: 0, minSessions: 2, maxMissedSessionRate: 0
        });
        expect(result).toMatchObject({ sessionsReviewed: 2, missedSessions: 1,
            missedSessionRate: 0.5 });
        expect(result.blockers).toContain('missed_session_rate');
    });
});
