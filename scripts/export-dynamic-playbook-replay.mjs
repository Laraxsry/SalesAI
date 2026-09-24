#!/usr/bin/env node
/**
 * Exports a privacy-minimized replay corpus. Mongo is read-only; the only
 * write is the explicitly named local output file, which is not overwritten.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sanitizeReplaySession } from '../apps/agent-worker/src/replay-fixture-sanitizer.js';
import { createAdaptiveSurveyPilotScope } from '../apps/agent-worker/src/adaptive-survey-pilot-scope.js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '..', '.env') });

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const reviewMapIndex = args.indexOf('--review-map');
const recentIndex = args.indexOf('--recent');
const pilotAgentIndex = args.indexOf('--pilot-agent-id');
const pilotProductIndex = args.indexOf('--pilot-product-id');
const wantLast = args.includes('--last');
const reservedValues = new Set([
    ...(outIndex >= 0 ? [outIndex + 1] : []),
    ...(reviewMapIndex >= 0 ? [reviewMapIndex + 1] : []),
    ...(recentIndex >= 0 ? [recentIndex + 1] : []),
    ...(pilotAgentIndex >= 0 ? [pilotAgentIndex + 1] : []),
    ...(pilotProductIndex >= 0 ? [pilotProductIndex + 1] : [])
]);
const target = args.find((arg, index) => !arg.startsWith('--') && !reservedValues.has(index));
const outputPath = outIndex >= 0 ? args[outIndex + 1] : null;
const reviewMapPath = reviewMapIndex >= 0 ? args[reviewMapIndex + 1] : null;
const recentCount = recentIndex >= 0 ? Number(args[recentIndex + 1]) : null;
const pilotAgentId = pilotAgentIndex >= 0 ? args[pilotAgentIndex + 1] : null;
const pilotProductId = pilotProductIndex >= 0 ? args[pilotProductIndex + 1] : null;
const salt = process.env.REPLAY_ANONYMIZATION_SALT;

if (!outputPath || (!target && !wantLast && !Number.isInteger(recentCount))) {
    console.error('kullanım: npm run playbook:export-replay -- <sessionId|roomName> | --last | --recent N [--pilot-agent-id ID --pilot-product-id ID] --out fixture.json [--review-map private-map.json]');
    process.exit(1);
}
if (outputPath.startsWith('--') || (reviewMapIndex >= 0
    && (!reviewMapPath || reviewMapPath.startsWith('--')
        || resolve(process.cwd(), reviewMapPath) === resolve(process.cwd(), outputPath)))) {
    console.error('--review-map mevcut ve --out konumundan farklı bir dosya olmalı');
    process.exit(1);
}
if (!salt || salt.length < 16) {
    console.error('REPLAY_ANONYMIZATION_SALT en az 16 karakter olmalı; salt CLI argümanı olarak kabul edilmez');
    process.exit(1);
}
if (recentCount !== null && (!Number.isInteger(recentCount) || recentCount < 1 || recentCount > 500)) {
    console.error('--recent 1 ile 500 arasında bir tam sayı olmalı');
    process.exit(1);
}
if ((pilotAgentIndex >= 0 || pilotProductIndex >= 0) && (recentCount === null
    || pilotAgentIndex < 0 || pilotProductIndex < 0
    || !mongoose.Types.ObjectId.isValid(pilotAgentId)
    || !mongoose.Types.ObjectId.isValid(pilotProductId))) {
    console.error('pilot export için --recent N, --pilot-agent-id ve --pilot-product-id gerekli');
    process.exit(1);
}

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
    console.error('MONGODB_URI tanımlı değil (.env)');
    process.exit(1);
}

let corpusWritten = false;
try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    let sessions = [];
    if (recentCount !== null) {
        if (pilotAgentId) {
            const agent = await db.collection('agents').findOne({
                _id: new mongoose.Types.ObjectId(pilotAgentId),
                productId: new mongoose.Types.ObjectId(pilotProductId)
            }, { projection: { _id: 1 } });
            if (!agent) throw new Error('pilot agent-ürün eşleşmesi doğrulanamadı');
        }
        sessions = await db.collection('sessions').find(pilotAgentId
            ? { agentId: new mongoose.Types.ObjectId(pilotAgentId) } : {})
            .sort({ startedAt: -1 }).limit(recentCount).toArray();
    } else if (wantLast) {
        const session = await db.collection('sessions').find({})
            .sort({ startedAt: -1 }).limit(1).next();
        if (session) sessions = [session];
    } else {
        let session;
        if (mongoose.Types.ObjectId.isValid(target)) {
            session = await db.collection('sessions').findOne({
                _id: new mongoose.Types.ObjectId(target)
            });
        }
        if (!session) session = await db.collection('sessions').findOne({ roomName: target });
        if (session) sessions = [session];
    }
    if (sessions.length === 0) throw new Error('dışa aktarılacak oturum bulunamadı');

    const fixtures = [];
    const mappings = [];
    const pilotScope = pilotAgentId
        ? createAdaptiveSurveyPilotScope({ agentId: pilotAgentId, productId: pilotProductId, salt })
        : null;
    for (const session of sessions) {
        const events = await db.collection('sessionevents')
            .find({ sessionId: session._id })
            .sort({ seq: 1 })
            .toArray();
        const fixture = sanitizeReplaySession({
            sessionId: String(session._id),
            events
        }, { salt });
        if (pilotScope) fixture.pilotScope = pilotScope;
        fixtures.push(fixture);
        if (reviewMapPath) {
            mappings.push({ fixtureId: fixture.fixtureId, sessionId: String(session._id) });
        }
    }
    const corpus = {
        schemaVersion: 1,
        privacy: 'allowlist-projected-pseudonymous',
        fixtureCount: fixtures.length,
        ...(pilotScope ? { pilotScope } : {}),
        fixtures
    };
    await writeFile(resolve(process.cwd(), outputPath), `${JSON.stringify(corpus, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx'
    });
    corpusWritten = true;
    if (reviewMapPath) {
        await writeFile(resolve(process.cwd(), reviewMapPath), `${JSON.stringify({
            schemaVersion: 1,
            sensitive: true,
            purpose: 'authorized_review_lookup_only',
            mappings
        }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    console.log(`anonim replay corpus yazıldı: ${outputPath} (${fixtures.length} fixture)`);
    if (reviewMapPath) console.log('ayrı hassas inceleme eşlemesi yazıldı; corpus ile birlikte paylaşmayın');
} catch (error) {
    console.error(error.code === 'EEXIST'
        ? `çıktı dosyası zaten var; üzerine yazılmadı: ${corpusWritten ? reviewMapPath : outputPath}`
        : error.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect().catch(() => {});
}
