import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { sanitizeReplaySession } from './replay-fixture-sanitizer.js';
import {
    buildAdaptiveSurveyShadowReviewQueue,
    evaluateAdaptiveSurveyShadowHumanReview
} from './adaptive-survey-shadow-human-review.js';

const salt = 'shadow-human-review-test-salt';

function fixture(index, status = 'approved') {
    const proposalId = `shadow-proposal-${index}`;
    return sanitizeReplaySession({ sessionId: `shadow-session-${index}`, events: [
        { seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION,
            meta: { questionKey: 'company.industry', status: 'unknown_field_candidate',
                factStatus: 'unknown', turnIndex: 1 } },
        { seq: 2, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL,
            meta: { proposalId, questionKey: 'company.industry', status,
                reason: status === 'approved' ? 'policy_passed' : 'fact_already_known',
                question: 'Private question' } }
    ] }, { salt });
}

describe('shadow proposal human review', () => {
    it('reviews proposed and withheld decisions without authorizing rollout', () => {
        const fixtures = [
            ...Array.from({ length: 10 }, (_, index) => fixture(index)),
            ...Array.from({ length: 10 }, (_, index) => fixture(index + 10, 'rejected'))
        ];
        const queue = buildAdaptiveSurveyShadowReviewQueue(fixtures);
        expect(queue).toMatchObject({ candidateCount: 20, shadowSessionCount: 20 });
        expect(JSON.stringify(queue)).not.toContain('Private question');
        const labels = queue.items.map(({ fixtureId, proposalId, group }) => ({
            fixtureId, proposalId,
            verdict: group === 'proposed' ? 'appropriate' : 'correctly_withheld'
        }));
        const annotations = { schemaVersion: 1, corpusHash: queue.corpusHash,
            labels, sessionLabels: queue.sessionItems.map(({ fixtureId }) => ({
                fixtureId, verdict: 'no_missed_opportunity'
            })) };
        expect(evaluateAdaptiveSurveyShadowHumanReview(queue, annotations))
            .toMatchObject({ checksPassed: true, rolloutAuthorized: false,
                proposedReviewed: 10, withheldReviewed: 10,
                byQuestionKey: [{ proposed: 10, withheld: 10,
                    appropriate: 10, correctlyWithheld: 10,
                    irrelevant: 0, mistimed: 0, missedOpportunity: 0 }] });
        const poor = evaluateAdaptiveSurveyShadowHumanReview(queue, {
            ...annotations, labels: labels.map((label, index) => index === 0
                ? { ...label, verdict: 'irrelevant' } : label)
        }, { maxIssueRate: 0 });
        expect(poor.blockers).toContain('proposal_issue_rate');
        expect(poor.byQuestionKey[0].irrelevant).toBe(1);
    });

    it('rejects stale labels, raw fixtures and duplicate items', () => {
        const original = fixture(1);
        const queue = buildAdaptiveSurveyShadowReviewQueue([original]);
        expect(() => evaluateAdaptiveSurveyShadowHumanReview(queue, {
            schemaVersion: 1, corpusHash: 'stale', labels: [], sessionLabels: []
        })).toThrow(/do not match/);
        expect(() => buildAdaptiveSurveyShadowReviewQueue([{
            fixtureId: 'raw-session', events: []
        }])).toThrow(/anonymized/);
        const duplicate = structuredClone(original);
        duplicate.events.push({ ...duplicate.events.at(-1), seq: 3 });
        expect(() => buildAdaptiveSurveyShadowReviewQueue([duplicate]))
            .toThrow(/duplicate shadow proposal/);
        const leakedKey = structuredClone(original);
        leakedKey.events.at(-1).meta.questionKey = 'company.industry';
        expect(() => buildAdaptiveSurveyShadowReviewQueue([leakedKey]))
            .toThrow(/pseudonymous identifiers/);
    });

    it('binds labels to the exact shadow corpus and pilot scope', () => {
        const original = fixture(2);
        const changed = structuredClone(original);
        changed.pilotScope = 'pilot_scope:anon:0123456789abcdef0123456789abcdef';
        expect(buildAdaptiveSurveyShadowReviewQueue([original]).corpusHash)
            .not.toBe(buildAdaptiveSurveyShadowReviewQueue([changed]).corpusHash);
    });

    it('runs the read-only review command on an anonymized corpus', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'shadow-review-test-'));
        try {
            const corpusPath = join(directory, 'corpus.json');
            await writeFile(corpusPath, JSON.stringify({
                schemaVersion: 1, privacy: 'allowlist-projected-pseudonymous',
                fixtureCount: 1, fixtures: [fixture(3)]
            }));
            const output = JSON.parse(execFileSync(process.execPath, [
                fileURLToPath(new URL('../../../scripts/adaptive-survey-shadow-review.mjs',
                    import.meta.url)), '--corpus', corpusPath
            ], { cwd: process.cwd(), encoding: 'utf8' }));
            expect(output).toMatchObject({ readOnly: true, rolloutAuthorized: false,
                queue: { candidateCount: 1 }, shadowAggregate: { proposals: 1 } });
            expect(output.annotationTemplate.labels).toHaveLength(1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
