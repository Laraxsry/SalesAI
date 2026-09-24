import { createHash } from 'node:crypto';
import { TIMELINE_EVENTS } from './session-timeline.js';

const FIXTURE_ID = /^session:anon:[a-f0-9]{16}$/;
const PROPOSAL_ID = /^survey_proposal:anon:[a-f0-9]{16}$/;
const QUESTION_KEY = /^question_key:anon:[a-f0-9]{16}$/;
const MAX_SAMPLE = 20;
const PROPOSED_VERDICTS = new Set(['appropriate', 'irrelevant', 'mistimed', 'uncertain']);
const WITHHELD_VERDICTS = new Set(['correctly_withheld', 'missed_opportunity', 'uncertain']);
const SESSION_VERDICTS = new Set(['no_missed_opportunity', 'missed_opportunity', 'uncertain']);

function ratio(top, bottom) { return bottom > 0 ? top / bottom : null; }

/** Privacy-minimized queue for independent review of shadow-only proposals. */
export function buildAdaptiveSurveyShadowReviewQueue(fixtures) {
    if (!Array.isArray(fixtures)) throw new TypeError('anonymized fixtures are required');
    const seenFixtures = new Set();
    const reviewedFixtures = [];
    const items = [];
    const sessionItems = [];
    const seenProposals = new Set();
    for (const fixture of fixtures) {
        if (!FIXTURE_ID.test(fixture?.fixtureId)
            || fixture.privacy?.allowlistProjection !== true
            || !Array.isArray(fixture.events)
            || seenFixtures.has(fixture.fixtureId)) {
            throw new TypeError('only unique anonymized replay fixtures can be reviewed');
        }
        seenFixtures.add(fixture.fixtureId);
        const events = [...fixture.events].sort((a, b) => a.seq - b.seq);
        const shadow = events.filter((event) => [
            TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION,
            TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL
        ].includes(event.type));
        if (shadow.length === 0) continue;
        reviewedFixtures.push({ fixtureId: fixture.fixtureId,
            ...(fixture.pilotScope ? { pilotScope: fixture.pilotScope } : {}), events: shadow });
        sessionItems.push({ fixtureId: fixture.fixtureId });
        for (const event of shadow) {
            if (event.type !== TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL) continue;
            if (!PROPOSAL_ID.test(event.meta?.proposalId)
                || !QUESTION_KEY.test(event.meta?.questionKey)) {
                throw new TypeError('shadow proposal must contain pseudonymous identifiers');
            }
            if (event.meta.status === 'ignored') continue;
            if (!['approved', 'rejected', 'deferred', 'verify_voice']
                .includes(event.meta.status)) {
                throw new TypeError('invalid shadow proposal decision');
            }
            const proposalKey = `${fixture.fixtureId}:${event.meta.proposalId}`;
            if (seenProposals.has(proposalKey)) {
                throw new TypeError('duplicate shadow proposal ID');
            }
            seenProposals.add(proposalKey);
            items.push({ fixtureId: fixture.fixtureId,
                proposalId: event.meta.proposalId,
                questionKey: event.meta.questionKey,
                decision: event.meta.status,
                group: event.meta.status === 'approved' ? 'proposed' : 'withheld' });
        }
    }
    reviewedFixtures.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
    items.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId)
        || a.proposalId.localeCompare(b.proposalId));
    sessionItems.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
    const corpusHash = createHash('sha256').update(JSON.stringify(reviewedFixtures)).digest('hex');
    return {
        schemaVersion: 1, corpusHash,
        candidateCount: items.length, shadowSessionCount: sessionItems.length,
        sampling: 'first_20_pseudonymous_ids_per_group',
        items: [
            ...items.filter((item) => item.group === 'proposed').slice(0, MAX_SAMPLE),
            ...items.filter((item) => item.group === 'withheld').slice(0, MAX_SAMPLE)
        ],
        sessionItems: sessionItems.slice(0, MAX_SAMPLE)
    };
}

/** Human labels assess relevance; policy approval alone never proves quality. */
export function evaluateAdaptiveSurveyShadowHumanReview(queue, annotations, {
    minProposed = 10, minWithheld = 10, minSessions = 10,
    minCoverage = 0.8, maxIssueRate = 0.1,
    maxMissedOpportunityRate = 0.1, maxMissedSessionRate = 0.1
} = {}) {
    if (queue?.schemaVersion !== 1 || annotations?.schemaVersion !== 1
        || annotations.corpusHash !== queue.corpusHash
        || !Array.isArray(annotations.labels) || !Array.isArray(annotations.sessionLabels)) {
        throw new TypeError('shadow review annotations do not match this corpus');
    }
    const candidates = new Map(queue.items.map((item) => [
        `${item.fixtureId}:${item.proposalId}`, item
    ]));
    const seen = new Set();
    const counts = { proposedReviewed: 0, withheldReviewed: 0,
        irrelevant: 0, mistimed: 0, missedOpportunity: 0, uncertain: 0 };
    const byQuestionKey = new Map();
    for (const item of queue.items) {
        const group = byQuestionKey.get(item.questionKey) ?? {
            questionKey: item.questionKey, proposed: 0, withheld: 0,
            appropriate: 0, irrelevant: 0, mistimed: 0,
            correctlyWithheld: 0, missedOpportunity: 0, uncertain: 0
        };
        group[item.group]++;
        byQuestionKey.set(item.questionKey, group);
    }
    for (const label of annotations.labels) {
        const key = `${label?.fixtureId}:${label?.proposalId}`;
        const item = candidates.get(key);
        if (!item || seen.has(key)) throw new TypeError('unknown or duplicate shadow review item');
        const valid = item.group === 'proposed' ? PROPOSED_VERDICTS : WITHHELD_VERDICTS;
        if (!valid.has(label.verdict)) throw new TypeError('invalid shadow review verdict');
        seen.add(key);
        const group = byQuestionKey.get(item.questionKey);
        const verdictField = {
            appropriate: 'appropriate', irrelevant: 'irrelevant', mistimed: 'mistimed',
            correctly_withheld: 'correctlyWithheld',
            missed_opportunity: 'missedOpportunity', uncertain: 'uncertain'
        }[label.verdict];
        group[verdictField]++;
        if (label.verdict === 'uncertain') { counts.uncertain++; continue; }
        if (item.group === 'proposed') counts.proposedReviewed++;
        else counts.withheldReviewed++;
        if (label.verdict === 'irrelevant') counts.irrelevant++;
        if (label.verdict === 'mistimed') counts.mistimed++;
        if (label.verdict === 'missed_opportunity') counts.missedOpportunity++;
    }
    const eligibleSessions = new Set(queue.sessionItems.map((item) => item.fixtureId));
    const seenSessions = new Set();
    let sessionsReviewed = 0;
    let missedSessions = 0;
    for (const label of annotations.sessionLabels) {
        if (!eligibleSessions.has(label?.fixtureId) || seenSessions.has(label.fixtureId)) {
            throw new TypeError('unknown or duplicate shadow session review item');
        }
        if (!SESSION_VERDICTS.has(label.verdict)) {
            throw new TypeError('invalid shadow session verdict');
        }
        seenSessions.add(label.fixtureId);
        if (label.verdict !== 'uncertain') sessionsReviewed++;
        if (label.verdict === 'missed_opportunity') missedSessions++;
    }
    const proposedCount = queue.items.filter((item) => item.group === 'proposed').length;
    const withheldCount = queue.items.filter((item) => item.group === 'withheld').length;
    const issueRate = ratio(counts.irrelevant + counts.mistimed, counts.proposedReviewed);
    const missedOpportunityRate = ratio(counts.missedOpportunity, counts.withheldReviewed);
    const missedSessionRate = ratio(missedSessions, sessionsReviewed);
    const checks = [
        ['minimum_reviewed_proposed', counts.proposedReviewed >= minProposed],
        ['minimum_reviewed_withheld', counts.withheldReviewed >= minWithheld],
        ['minimum_reviewed_sessions', sessionsReviewed >= minSessions],
        ['proposed_review_coverage', ratio(counts.proposedReviewed, proposedCount) >= minCoverage],
        ['withheld_review_coverage', ratio(counts.withheldReviewed, withheldCount) >= minCoverage],
        ['session_review_coverage', ratio(sessionsReviewed, queue.sessionItems.length) >= minCoverage],
        ['proposal_issue_rate', issueRate !== null && issueRate <= maxIssueRate],
        ['missed_opportunity_rate', missedOpportunityRate !== null
            && missedOpportunityRate <= maxMissedOpportunityRate],
        ['missed_session_rate', missedSessionRate !== null
            && missedSessionRate <= maxMissedSessionRate]
    ].map(([id, passed]) => ({ id, passed }));
    return {
        ...counts, sessionsReviewed, missedSessions,
        byQuestionKey: [...byQuestionKey.values()]
            .sort((a, b) => a.questionKey.localeCompare(b.questionKey)),
        issueRate, missedOpportunityRate, missedSessionRate,
        checksPassed: checks.every((check) => check.passed),
        blockers: checks.filter((check) => !check.passed).map((check) => check.id),
        checks, rolloutAuthorized: false
    };
}
