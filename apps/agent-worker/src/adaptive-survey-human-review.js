import { createHash } from 'node:crypto';
import { TIMELINE_EVENTS } from './session-timeline.js';

const FIXTURE_ID = /^session:anon:[a-f0-9]{16}$/;
const PROPOSAL_ID = /^survey_proposal:anon:[a-f0-9]{16}$/;
const OPENED_VERDICTS = new Set(['appropriate', 'unnecessary', 'mistimed', 'uncertain']);
const SUPPRESSED_VERDICTS = new Set(['correctly_suppressed', 'missed_opportunity', 'uncertain']);
const SESSION_VERDICTS = new Set(['no_missed_opportunity', 'missed_opportunity', 'uncertain']);
const MAX_ITEMS_PER_GROUP = 20;

function ratio(top, bottom) { return bottom > 0 ? top / bottom : null; }

/** A privacy-minimized index, never a substitute for authorized call review. */
export function buildAdaptiveSurveyReviewQueue(fixtures) {
    if (!Array.isArray(fixtures)) throw new TypeError('anonymized fixtures are required');
    const items = [];
    const reviewedFixtures = [];
    const pilotSessions = [];
    const seenFixtures = new Set();
    for (const fixture of fixtures) {
        if (!FIXTURE_ID.test(fixture?.fixtureId)
            || fixture?.privacy?.allowlistProjection !== true
            || !Array.isArray(fixture.events)) {
            throw new TypeError('only anonymized replay fixtures can be reviewed');
        }
        if (seenFixtures.has(fixture.fixtureId)) throw new TypeError('duplicate fixture ID');
        seenFixtures.add(fixture.fixtureId);
        const events = [...fixture.events].sort((a, b) => a.seq - b.seq);
        const config = events.find((event) => event.type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG)?.meta;
        if (config?.enabled !== true || config.cohort !== 'canary') continue;
        reviewedFixtures.push({ fixtureId: fixture.fixtureId,
            ...(fixture.pilotScope ? { pilotScope: fixture.pilotScope } : {}), events });
        pilotSessions.push(fixture.fixtureId);
        const candidates = new Map();
        for (const event of events) {
            if (![TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION,
                TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE].includes(event.type)) continue;
            const id = event.meta?.proposalId;
            if (!PROPOSAL_ID.test(id)) continue;
            const current = candidates.get(id) ?? {
                fixtureId: fixture.fixtureId, proposalId: id,
                decision: null, opened: false, outcome: null
            };
            if (event.type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION) {
                current.decision = ['approved', 'rejected', 'deferred', 'verify_voice']
                    .includes(event.meta?.status) ? event.meta.status : null;
            } else if (event.meta?.event === 'opened') {
                current.opened = true;
            } else if (['answered', 'dismissed', 'expired', 'customer_interrupted']
                .includes(event.meta?.event)) {
                current.outcome = event.meta.event;
            }
            candidates.set(id, current);
        }
        for (const candidate of candidates.values()) {
            if (candidate.opened) {
                items.push({ ...candidate, group: 'opened' });
            } else if (['rejected', 'deferred', 'verify_voice'].includes(candidate.decision)) {
                items.push({ ...candidate, group: 'suppressed' });
            }
        }
    }
    items.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId)
        || a.proposalId.localeCompare(b.proposalId));
    const sampled = [
        ...items.filter((item) => item.group === 'opened').slice(0, MAX_ITEMS_PER_GROUP),
        ...items.filter((item) => item.group === 'suppressed').slice(0, MAX_ITEMS_PER_GROUP)
    ];
    reviewedFixtures.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
    const corpusHash = createHash('sha256')
        .update(JSON.stringify(reviewedFixtures))
        .digest('hex');
    pilotSessions.sort();
    return {
        schemaVersion: 2, corpusHash, candidateCount: items.length,
        pilotSessionCount: pilotSessions.length,
        sampling: 'first_20_pseudonymous_ids_per_group',
        items: sampled,
        sessionItems: pilotSessions.slice(0, MAX_ITEMS_PER_GROUP)
            .map((fixtureId) => ({ fixtureId }))
    };
}

/** Strict labels: unknown IDs, duplicate labels and stale corpora fail closed. */
export function evaluateAdaptiveSurveyHumanReview(queue, annotations, {
    minOpened = 10, minSuppressed = 10, minSessions = 10,
    minCoverage = 0.8,
    maxUnnecessaryRate = 0.1, maxMissedOpportunityRate = 0.1,
    maxMissedSessionRate = 0.1
} = {}) {
    if (queue?.schemaVersion !== 2 || annotations?.schemaVersion !== 2
        || annotations.corpusHash !== queue.corpusHash
        || !Array.isArray(annotations.labels) || !Array.isArray(annotations.sessionLabels)) {
        throw new TypeError('review annotations do not match this corpus');
    }
    const candidates = new Map(queue.items.map((item) => [
        `${item.fixtureId}:${item.proposalId}`, item
    ]));
    const seen = new Set();
    const counts = {
        openedReviewed: 0, suppressedReviewed: 0, unnecessary: 0,
        mistimed: 0, missedOpportunity: 0, uncertain: 0
    };
    for (const label of annotations.labels) {
        const key = `${label?.fixtureId}:${label?.proposalId}`;
        const candidate = candidates.get(key);
        if (!candidate || seen.has(key)) throw new TypeError('unknown or duplicate review item');
        const valid = candidate.group === 'opened' ? OPENED_VERDICTS : SUPPRESSED_VERDICTS;
        if (!valid.has(label.verdict)) throw new TypeError('invalid verdict for review item');
        seen.add(key);
        if (label.verdict === 'uncertain') {
            counts.uncertain++;
            continue;
        }
        if (candidate.group === 'opened') counts.openedReviewed++;
        else counts.suppressedReviewed++;
        if (label.verdict === 'unnecessary') counts.unnecessary++;
        if (label.verdict === 'mistimed') counts.mistimed++;
        if (label.verdict === 'missed_opportunity') counts.missedOpportunity++;
    }
    const eligibleSessions = new Set(queue.sessionItems.map((item) => item.fixtureId));
    const seenSessions = new Set();
    let sessionsReviewed = 0;
    let missedSessions = 0;
    let uncertainSessions = 0;
    for (const label of annotations.sessionLabels) {
        if (!eligibleSessions.has(label?.fixtureId) || seenSessions.has(label.fixtureId)) {
            throw new TypeError('unknown or duplicate session review item');
        }
        if (!SESSION_VERDICTS.has(label.verdict)) throw new TypeError('invalid session verdict');
        seenSessions.add(label.fixtureId);
        if (label.verdict === 'uncertain') uncertainSessions++;
        else sessionsReviewed++;
        if (label.verdict === 'missed_opportunity') missedSessions++;
    }
    const openingIssueRate = ratio(counts.unnecessary + counts.mistimed, counts.openedReviewed);
    const missedOpportunityRate = ratio(counts.missedOpportunity, counts.suppressedReviewed);
    const openedSampleSize = queue.items.filter((item) => item.group === 'opened').length;
    const suppressedSampleSize = queue.items.filter((item) => item.group === 'suppressed').length;
    const openedCoverage = ratio(counts.openedReviewed, openedSampleSize);
    const suppressedCoverage = ratio(counts.suppressedReviewed, suppressedSampleSize);
    const sessionCoverage = ratio(sessionsReviewed, queue.sessionItems.length);
    const missedSessionRate = ratio(missedSessions, sessionsReviewed);
    const checks = [
        ['minimum_reviewed_opened', counts.openedReviewed >= minOpened, counts.openedReviewed, minOpened],
        ['minimum_reviewed_suppressed', counts.suppressedReviewed >= minSuppressed,
            counts.suppressedReviewed, minSuppressed],
        ['minimum_reviewed_sessions', sessionsReviewed >= minSessions,
            sessionsReviewed, minSessions],
        ['opened_review_coverage', openedCoverage !== null && openedCoverage >= minCoverage,
            openedCoverage, minCoverage],
        ['suppressed_review_coverage', suppressedCoverage !== null
            && suppressedCoverage >= minCoverage,
        suppressedCoverage, minCoverage],
        ['session_review_coverage', sessionCoverage !== null && sessionCoverage >= minCoverage,
            sessionCoverage, minCoverage],
        ['opening_issue_rate', openingIssueRate !== null && openingIssueRate <= maxUnnecessaryRate,
            openingIssueRate, maxUnnecessaryRate],
        ['missed_opportunity_rate', missedOpportunityRate !== null
            && missedOpportunityRate <= maxMissedOpportunityRate,
        missedOpportunityRate, maxMissedOpportunityRate],
        ['missed_session_rate', missedSessionRate !== null
            && missedSessionRate <= maxMissedSessionRate,
        missedSessionRate, maxMissedSessionRate]
    ].map(([id, passed, actual, threshold]) => ({ id, passed, actual, threshold }));
    return {
        queueSize: queue.items.length,
        sessionQueueSize: queue.sessionItems.length,
        labelled: seen.size,
        sessionsLabelled: seenSessions.size,
        sessionsReviewed,
        missedSessions,
        uncertainSessions,
        ...counts,
        openingIssueRate,
        missedOpportunityRate,
        openedCoverage,
        suppressedCoverage,
        sessionCoverage,
        missedSessionRate,
        checksPassed: checks.every((check) => check.passed),
        checks,
        blockers: checks.filter((check) => !check.passed).map((check) => check.id),
        readyForWiderPilot: false,
        note: 'Labels support human judgement; explicit rollout approval remains separate.'
    };
}
