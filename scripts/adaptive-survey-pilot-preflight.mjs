#!/usr/bin/env node
/** Read-only simulation of a proposed adaptive-survey pilot configuration. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { evaluateAdaptiveSurveyPilotPreflight } from '../apps/agent-worker/src/adaptive-survey-pilot-preflight.js';
import { validateAdaptiveSurveyCorpus } from '../apps/agent-worker/src/adaptive-survey-corpus.js';
import { createAdaptiveSurveyPilotScope } from '../apps/agent-worker/src/adaptive-survey-pilot-scope.js';
import { evaluateDynamicPlaybookTimeline } from '../apps/agent-worker/src/dynamic-playbook-eval.js';
import {
    aggregateAdaptiveSurveyReports,
    evaluateAdaptiveSurveyReadiness
} from '../apps/agent-worker/src/adaptive-survey-readiness.js';
import {
    buildAdaptiveSurveyReviewQueue,
    evaluateAdaptiveSurveyHumanReview
} from '../apps/agent-worker/src/adaptive-survey-human-review.js';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1];
};
const planPath = valueAfter('--plan');
const corpusPath = valueAfter('--corpus');
const annotationsPath = valueAfter('--annotations');
dotenv.config({ path: resolve(process.cwd(), '.env') });

if (!planPath || planPath.startsWith('--')
    || (args.includes('--corpus') && (!corpusPath || corpusPath.startsWith('--')))
    || (args.includes('--annotations') && (!annotationsPath || annotationsPath.startsWith('--')))
    || (annotationsPath && !corpusPath)) {
    console.error('kullanım: node scripts/adaptive-survey-pilot-preflight.mjs --plan plan.json [--corpus anonymized.json --annotations labels.json]');
    process.exitCode = 1;
} else {
    try {
        const plan = JSON.parse(await readFile(resolve(process.cwd(), planPath), 'utf8'));
        let operationalReadiness = null;
        let humanReview = null;
        let corpusScopeMatched = false;
        if (corpusPath) {
            const corpus = JSON.parse(await readFile(resolve(process.cwd(), corpusPath), 'utf8'));
            const fixtures = validateAdaptiveSurveyCorpus(corpus);
            if (corpus.pilotScope && process.env.REPLAY_ANONYMIZATION_SALT) {
                corpusScopeMatched = corpus.pilotScope === createAdaptiveSurveyPilotScope({
                    agentId: plan.agentId, productId: plan.productId,
                    salt: process.env.REPLAY_ANONYMIZATION_SALT
                });
            }
            const queue = buildAdaptiveSurveyReviewQueue(fixtures);
            const reports = fixtures.map((fixture) => ({
                sessionId: fixture.fixtureId,
                ...evaluateDynamicPlaybookTimeline(fixture.events)
            }));
            operationalReadiness = evaluateAdaptiveSurveyReadiness(
                aggregateAdaptiveSurveyReports(reports)
            );
            if (annotationsPath) {
                const annotations = JSON.parse(await readFile(
                    resolve(process.cwd(), annotationsPath), 'utf8'
                ));
                humanReview = evaluateAdaptiveSurveyHumanReview(queue, annotations);
            }
        }
        console.log(JSON.stringify(evaluateAdaptiveSurveyPilotPreflight(plan, {
            operationalReadiness, humanReview, corpusScopeMatched
        }), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
