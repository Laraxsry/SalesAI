#!/usr/bin/env node
/** Read-only human calibration of anonymized shadow proposals. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateAdaptiveSurveyCorpus } from '../apps/agent-worker/src/adaptive-survey-corpus.js';
import {
    buildAdaptiveSurveyShadowReviewQueue,
    evaluateAdaptiveSurveyShadowHumanReview
} from '../apps/agent-worker/src/adaptive-survey-shadow-human-review.js';
import { evaluateDynamicPlaybookTimeline } from '../apps/agent-worker/src/dynamic-playbook-eval.js';
import { aggregateAdaptiveSurveyShadowReports }
    from '../apps/agent-worker/src/adaptive-survey-shadow-report.js';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
};
const corpusPath = valueAfter('--corpus');
const annotationsPath = valueAfter('--annotations');

if (!corpusPath || corpusPath.startsWith('--')
    || (args.includes('--annotations') && (!annotationsPath || annotationsPath.startsWith('--')))) {
    console.error('kullanım: npm run playbook:review-shadow-surveys -- --corpus anonymized.json [--annotations shadow-labels.json]');
    process.exitCode = 1;
} else {
    try {
        const corpus = JSON.parse(await readFile(resolve(process.cwd(), corpusPath), 'utf8'));
        const fixtures = validateAdaptiveSurveyCorpus(corpus);
        const queue = buildAdaptiveSurveyShadowReviewQueue(fixtures);
        const reports = fixtures.map((fixture) => ({
            sessionId: fixture.fixtureId,
            ...evaluateDynamicPlaybookTimeline(fixture.events)
        }));
        const annotations = annotationsPath
            ? JSON.parse(await readFile(resolve(process.cwd(), annotationsPath), 'utf8'))
            : null;
        console.log(JSON.stringify({
            readOnly: true,
            queue,
            shadowAggregate: aggregateAdaptiveSurveyShadowReports(reports),
            ...(annotations
                ? { humanReview: evaluateAdaptiveSurveyShadowHumanReview(queue, annotations) }
                : { annotationTemplate: {
                    schemaVersion: 1, corpusHash: queue.corpusHash,
                    labels: queue.items.map(({ fixtureId, proposalId }) => ({
                        fixtureId, proposalId, verdict: null
                    })),
                    sessionLabels: queue.sessionItems.map(({ fixtureId }) => ({
                        fixtureId, verdict: null
                    }))
                } }),
            rolloutAuthorized: false
        }, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
