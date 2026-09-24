#!/usr/bin/env node
/** Read-only, anonymized replay review queue and label evaluator. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateAdaptiveSurveyCorpus } from '../apps/agent-worker/src/adaptive-survey-corpus.js';
import {
    buildAdaptiveSurveyReviewQueue,
    evaluateAdaptiveSurveyHumanReview
} from '../apps/agent-worker/src/adaptive-survey-human-review.js';
import { evaluateDynamicPlaybookTimeline } from '../apps/agent-worker/src/dynamic-playbook-eval.js';
import {
    aggregateAdaptiveSurveyReports,
    evaluateAdaptiveSurveyReadiness
} from '../apps/agent-worker/src/adaptive-survey-readiness.js';
import { aggregateAdaptiveSurveyShadowReports }
    from '../apps/agent-worker/src/adaptive-survey-shadow-report.js';

const args = process.argv.slice(2);
const corpusIndex = args.indexOf('--corpus');
const annotationsIndex = args.indexOf('--annotations');
const corpusPath = corpusIndex >= 0 ? args[corpusIndex + 1] : null;
const annotationsPath = annotationsIndex >= 0 ? args[annotationsIndex + 1] : null;

if (!corpusPath || corpusPath.startsWith('--')
    || (annotationsIndex >= 0 && (!annotationsPath || annotationsPath.startsWith('--')))) {
    console.error('kullanım: node scripts/adaptive-survey-review.mjs --corpus anonymized.json [--annotations labels.json]');
    process.exitCode = 1;
} else {
    try {
        const corpus = JSON.parse(await readFile(resolve(process.cwd(), corpusPath), 'utf8'));
        const fixtures = validateAdaptiveSurveyCorpus(corpus);
        const queue = buildAdaptiveSurveyReviewQueue(fixtures);
        const reports = fixtures.map((fixture) => ({
            sessionId: fixture.fixtureId,
            ...evaluateDynamicPlaybookTimeline(fixture.events)
        }));
        const operationalAggregate = aggregateAdaptiveSurveyReports(reports);
        const operationalReadiness = evaluateAdaptiveSurveyReadiness(operationalAggregate);
        const annotations = annotationsPath
            ? JSON.parse(await readFile(resolve(process.cwd(), annotationsPath), 'utf8'))
            : null;
        const humanReview = annotations
            ? evaluateAdaptiveSurveyHumanReview(queue, annotations)
            : null;
        console.log(JSON.stringify({
            readOnly: true,
            queue,
            operationalAggregate,
            operationalReadiness,
            shadowObservations: aggregateAdaptiveSurveyShadowReports(reports),
            calibration: {
                operationalChecksPassed: operationalReadiness.operationalChecksPassed,
                humanReviewChecksPassed: humanReview?.checksPassed ?? false,
                evidenceChecksPassed: operationalReadiness.operationalChecksPassed
                    && humanReview?.checksPassed === true,
                rolloutAuthorized: false
            },
            ...(annotations
                ? { humanReview }
                : { annotationTemplate: {
                    schemaVersion: 2,
                    corpusHash: queue.corpusHash,
                    labels: queue.items.map(({ fixtureId, proposalId }) => ({
                        fixtureId, proposalId, verdict: null
                    })),
                    sessionLabels: queue.sessionItems.map(({ fixtureId }) => ({
                        fixtureId, verdict: null
                    }))
                } })
        }, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
