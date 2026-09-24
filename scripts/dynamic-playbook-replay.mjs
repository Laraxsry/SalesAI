#!/usr/bin/env node
/**
 * Read-only replay evaluator for persisted SessionEvent timelines.
 *
 *   node scripts/dynamic-playbook-replay.mjs --last
 *   node scripts/dynamic-playbook-replay.mjs <sessionId | roomName>
 *   node scripts/dynamic-playbook-replay.mjs --file replay.json
 *
 * A file may contain `{ events: [...] }`, `[{ events: [...] }]`, or a raw
 * event array. The command never changes rollout configuration or database
 * state; it only prints a JSON evidence report.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluateDynamicPlaybookTimeline } from '../apps/agent-worker/src/dynamic-playbook-eval.js';
import {
    aggregateDynamicPlaybookReports,
    evaluateDynamicPlaybookRolloutReadiness
} from '../apps/agent-worker/src/dynamic-playbook-rollout-readiness.js';
import { buildSemanticCalibrationReport } from '../apps/agent-worker/src/semantic-calibration.js';
import {
    aggregateAdaptiveSurveyReports,
    evaluateAdaptiveSurveyReadiness
} from '../apps/agent-worker/src/adaptive-survey-readiness.js';
import { aggregateAdaptiveSurveyShadowReports }
    from '../apps/agent-worker/src/adaptive-survey-shadow-report.js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '..', '.env') });

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const wantLast = args.includes('--last');
const target = args.find((arg, index) => !arg.startsWith('--') && index !== fileIndex + 1);

function normalizeReplayDocuments(value) {
    if (Array.isArray(value?.fixtures)) return value.fixtures;
    if (Array.isArray(value) && value.every((item) => item?.type)) return [{ events: value }];
    if (Array.isArray(value)) return value;
    return [value];
}

async function loadFromFile(path) {
    const parsed = JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
    return normalizeReplayDocuments(parsed).map((document, index) => ({
        sessionId: String(
            document.fixtureId ?? document.session?._id ?? document.sessionId ?? `file:${index + 1}`
        ),
        events: document.events ?? []
    }));
}

async function loadFromDatabase() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI tanımlı değil (.env)');
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    let session;
    if (wantLast) {
        session = await db.collection('sessions').find({}).sort({ startedAt: -1 }).limit(1).next();
    } else if (mongoose.Types.ObjectId.isValid(target)) {
        session = await db.collection('sessions').findOne({
            _id: new mongoose.Types.ObjectId(target)
        });
    }
    if (!session && target) {
        session = await db.collection('sessions').findOne({ roomName: target });
    }
    if (!session) throw new Error(`oturum bulunamadı: ${target ?? '--last'}`);
    const events = await db.collection('sessionevents')
        .find({ sessionId: session._id })
        .sort({ seq: 1 })
        .toArray();
    return [{ sessionId: String(session._id), events }];
}

if (fileIndex === -1 && !target && !wantLast) {
    console.error('kullanım: node scripts/dynamic-playbook-replay.mjs <sessionId | roomName> | --last | --file replay.json');
    process.exit(1);
}
if (fileIndex !== -1 && !args[fileIndex + 1]) {
    console.error('--file için bir JSON dosya yolu gerekli');
    process.exit(1);
}

try {
    const sessions = fileIndex === -1
        ? await loadFromDatabase()
        : await loadFromFile(args[fileIndex + 1]);
    const reports = sessions.map(({ sessionId, events }) => ({
        sessionId,
        ...evaluateDynamicPlaybookTimeline(events)
    }));
    const aggregate = aggregateDynamicPlaybookReports(reports);
    const adaptiveSurveyAggregate = aggregateAdaptiveSurveyReports(reports);
    console.log(JSON.stringify({
        generatedAt: new Date().toISOString(),
        readOnly: true,
        reports,
        aggregate,
        semanticCalibration: buildSemanticCalibrationReport(reports),
        readiness: evaluateDynamicPlaybookRolloutReadiness(aggregate),
        adaptiveSurvey: {
            aggregate: adaptiveSurveyAggregate,
            readiness: evaluateAdaptiveSurveyReadiness(adaptiveSurveyAggregate)
        },
        adaptiveSurveyShadow: aggregateAdaptiveSurveyShadowReports(reports)
    }, null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect().catch(() => {});
}
