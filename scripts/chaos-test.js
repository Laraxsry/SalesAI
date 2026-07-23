#!/usr/bin/env node
/**
 * Chaos test (Phase 7 — md/backend/phase7_hardening_observability.md, Task 6:
 * "kill a provider/dependency mid-session and assert fallback").
 *
 * Deliberately breaks one real provider's connectivity in-process and proves
 * @repo/resilience's fallback chain actually recovers, using the exact same
 * wiring production code calls (getLLM(), getVectorStore()) — not a mock of
 * our own code, a real fault (bad API key / unreachable URL) against a real
 * dependency.
 *
 * Deliberately NOT wired into `npm run test`/CI: these legs hit real external
 * providers (OpenAI/Anthropic — a few cents of real cost per run) or
 * intentionally misconfigure real local infra (Qdrant), so running them on
 * every commit would be slow, occasionally flaky on real provider hiccups,
 * and not free. This mirrors how chaos engineering is normally practiced —
 * a deliberate, manually-run exercise, not an always-on check.
 *
 * Each scenario runs a precondition check on the *secondary* provider first:
 * if the secondary is itself unavailable right now, a failure below would be
 * a real, unrelated outage, not evidence our fallback code regressed — that
 * case is reported as SKIP, distinct from FAIL.
 *
 * Usage: npm run chaos:test
 */
import '@repo/config-env/load';
import { Types } from 'mongoose';
import { connectDB, disconnectDB } from '@repo/database';
import { getLLM } from '@repo/ai';
import { getVectorStore, MongoVectorStore, QdrantVectorStore } from '@repo/rag';

const results = [];

function report(name, status, detail) {
    results.push({ name, status });
    const icon = status === 'PASS' ? '✅' : status === 'SKIP' ? '⚠️ ' : '❌';
    console.log(`${icon} [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Polls `fn` every second (up to `timeoutMs`) until `isDone` returns true; returns whether it succeeded in time. */
async function pollFor(fn, isDone, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    do {
        if (isDone(await fn())) return true;
        await new Promise((r) => setTimeout(r, 1000));
    } while (Date.now() < deadline);
    return false;
}

/**
 * Breaks OPENAI_API_KEY (the primary in the default `openai,anthropic`
 * LLM_FALLBACK_CHAIN) and confirms getLLM() still returns a real completion
 * from Anthropic.
 */
async function chaosLLM() {
    const name = 'LLM fallback (openai -> anthropic)';
    const prompt = { messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }] };

    try {
        const res = await getLLM('anthropic').complete(prompt);
        if (!res.text?.trim()) throw new Error('empty response');
    } catch (err) {
        return report(name, 'SKIP', `secondary (anthropic) itself is unavailable right now, unrelated to our code: ${err.message}`);
    }

    // Must happen before the first-ever construction of the OpenAI client in
    // this process — packages/ai/src/openai-client.js caches it as a
    // module-level singleton once created, so this only works pre-first-use.
    process.env.OPENAI_API_KEY = 'sk-chaos-test-deliberately-invalid';

    try {
        const res = await getLLM().complete(prompt);
        if (!res.text?.trim()) throw new Error('fallback returned an empty response');
        report(name, 'PASS', `openai failed as expected, anthropic answered: "${res.text.trim().slice(0, 40)}"`);
    } catch (err) {
        report(name, 'FAIL', `both providers failed — fallback did not recover: ${err.message}`);
    }
}

/**
 * Seeds one real chunk into both stores, breaks QDRANT_URL (the primary),
 * and confirms getVectorStore() still finds the chunk via MongoDB.
 */
async function chaosVectorStore() {
    const name = 'Vector store fallback (qdrant -> mongodb)';
    const productId = String(new Types.ObjectId());
    const sourceId = String(new Types.ObjectId()); // KnowledgeChunk.sourceId is an ObjectId ref, not a free-form string
    const embedding = Array.from({ length: Number(process.env.EMBEDDING_DIM || 3072) }, () => Math.random());
    const chunk = { productId, sourceId, text: 'chaos test chunk', embedding };

    const mongoStore = new MongoVectorStore();
    const qdrantStore = new QdrantVectorStore();
    const cleanup = () => Promise.all([
        mongoStore.deleteBySource(sourceId).catch(() => {}),
        qdrantStore.deleteBySource(sourceId).catch(() => {})
    ]);

    try {
        await mongoStore.upsert([chunk]);
        await qdrantStore.upsert([chunk]); // also creates the Qdrant collection if it doesn't exist yet
    } catch (err) {
        return report(name, 'SKIP', `could not seed test data into both stores: ${err.message}`);
    }

    try {
        // A freshly-inserted document isn't necessarily searchable the
        // instant insertMany() resolves — MongoDB Atlas Search indexes
        // asynchronously (typically under a second, but not guaranteed), so
        // poll briefly rather than treating one immediate empty result as a
        // real outage.
        const found = await pollFor(() => mongoStore.query({ productId, embedding, topK: 1 }),
            (res) => res.some((r) => r.sourceId === sourceId));
        if (!found) throw new Error('seeded chunk not found in mongodb precondition check after 10s');
    } catch (err) {
        await cleanup();
        return report(name, 'SKIP', `secondary (mongodb) itself is unavailable right now, unrelated to our code: ${err.message}`);
    }

    // Must happen before the first-ever getVectorStore() call in this process
    // — its internal singleton cache (keyed by store name) is a *different*
    // instance from the throwaway ones just used to seed data above.
    process.env.QDRANT_URL = 'http://127.0.0.1:1';
    process.env.VECTOR_STORE = 'qdrant';
    process.env.VECTOR_STORE_FALLBACK_CHAIN = 'qdrant,mongodb';

    try {
        const res = await getVectorStore().query({ productId, embedding, topK: 1 });
        if (!res.some((r) => r.sourceId === sourceId)) {
            throw new Error('fallback query did not return the seeded chunk');
        }
        report(name, 'PASS', 'qdrant failed as expected, mongodb returned the seeded chunk');
    } catch (err) {
        report(name, 'FAIL', `both stores failed — fallback did not recover: ${err.message}`);
    } finally {
        await cleanup();
    }
}

async function main() {
    await connectDB();
    await chaosLLM();
    await chaosVectorStore();
    await disconnectDB();

    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const skipped = results.filter((r) => r.status === 'SKIP').length;
    console.log(`\n${results.length} scenario(s): ${passed} passed, ${failed} failed, ${skipped} skipped.`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('chaos-test crashed:', err);
    process.exit(1);
});
