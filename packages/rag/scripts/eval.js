import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { retrieve } from '../src/retrieve.js';
import { connectDB, mongoose } from '@repo/database';
import { getLLM } from '@repo/ai';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const DATASET_PATH = path.resolve(here, 'eval-dataset.json');

// Pinned to a single, fixed provider rather than getLLM()'s resilient
// fallback chain (openai -> anthropic) — if the primary provider happens to
// be down on a given night and traffic silently falls back to the secondary,
// that night's scores would reflect "a different model answered today", not
// "did our prompt/retrieval code regress". A regression signal has to compare
// the same model against itself night over night to mean anything.
const EVAL_PROVIDER = process.env.EVAL_LLM_PROVIDER || 'openai';

// Below this average, the run is considered a quality regression (Phase 7 —
// "nightly grounding eval gates deploys"). Starting point, not a settled
// number — recalibrate once the golden set is bigger and real nightly scores
// exist to tune against.
const MIN_AVG_FAITHFULNESS = Number(process.env.EVAL_MIN_FAITHFULNESS || 0.7);
const MIN_AVG_RELEVANCY = Number(process.env.EVAL_MIN_RELEVANCY || 0.7);

async function evaluatePair(pair, llm) {
    console.log(`\nEvaluating Q: "${pair.question}"`);
    
    // 1. Retrieve context
    const chunks = await retrieve({ productId: pair.productId, query: pair.question, topK: 5 });
    const contextText = chunks.map(c => c.text).join('\n\n');
    
    // 2. Generate answer
    const systemPrompt = `You are an AI sales assistant. Answer based only on the provided context. If you don't know, say "I don't know".\n\nCONTEXT:\n${contextText}`;
    const response = await llm.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: pair.question }]
    });
    const actualAnswer = response.text;

    // 3. Eval: Faithfulness (Is the answer supported by context?)
    const faithfulnessPrompt = `
You are an expert evaluator. Given a QUESTION, an ANSWER, and a CONTEXT, your job is to determine if the ANSWER is entirely supported by the CONTEXT.
Output only a JSON object with "score" (0 to 1) and "reason".

QUESTION: ${pair.question}
CONTEXT: ${contextText}
ANSWER: ${actualAnswer}
`;
    const fResp = await llm.complete({ system: faithfulnessPrompt, messages: [] });
    let faithfulness = { score: 0, reason: "Parse error" };
    try {
        const cleaned = fResp.text.replace(/```json/g, '').replace(/```/g, '').trim();
        faithfulness = JSON.parse(cleaned);
    } catch { console.error('Failed to parse faithfulness JSON'); }

    // 4. Eval: Relevancy (Does the answer match the expected answer?)
    const relevancyPrompt = `
You are an expert evaluator. Given a QUESTION, an EXPECTED_ANSWER, and an ACTUAL_ANSWER, score how well the ACTUAL_ANSWER covers the EXPECTED_ANSWER.
Output only a JSON object with "score" (0 to 1) and "reason".

QUESTION: ${pair.question}
EXPECTED_ANSWER: ${pair.expectedAnswer}
ACTUAL_ANSWER: ${actualAnswer}
`;
    const rResp = await llm.complete({ system: relevancyPrompt, messages: [] });
    let relevancy = { score: 0, reason: "Parse error" };
    try {
        const cleaned = rResp.text.replace(/```json/g, '').replace(/```/g, '').trim();
        relevancy = JSON.parse(cleaned);
    } catch { console.error('Failed to parse relevancy JSON'); }

    return {
        question: pair.question,
        faithfulness: faithfulness.score,
        relevancy: relevancy.score,
        fReason: faithfulness.reason,
        rReason: relevancy.reason
    };
}

async function main() {
    await connectDB();
    const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
    const llm = getLLM(EVAL_PROVIDER);

    console.log(`Loaded ${dataset.length} pairs from eval-dataset.json`);
    
    const results = [];
    for (const pair of dataset) {
        if (pair.productId.includes('BURAYA')) {
            console.warn('⚠️ Skipping sample pair (productId not set)');
            continue;
        }
        const res = await evaluatePair(pair, llm);
        results.push(res);
    }

    if (results.length === 0) {
        console.warn('\nNo real pairs evaluated (dataset only has placeholder entries) — nothing to gate on.');
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log('\n=== EVALUATION REPORT ===');
    let avgF = 0, avgR = 0;
    for (const r of results) {
        console.log(`Q: ${r.question}`);
        console.log(`  Faithfulness: ${r.faithfulness} (${r.fReason})`);
        console.log(`  Relevancy:    ${r.relevancy} (${r.rReason})`);
        avgF += r.faithfulness;
        avgR += r.relevancy;
    }
    avgF /= results.length;
    avgR /= results.length;
    console.log(`\nAverage Faithfulness: ${avgF} (min ${MIN_AVG_FAITHFULNESS})`);
    console.log(`Average Relevancy:    ${avgR} (min ${MIN_AVG_RELEVANCY})`);

    await mongoose.disconnect();

    const regressed = avgF < MIN_AVG_FAITHFULNESS || avgR < MIN_AVG_RELEVANCY;
    if (regressed) {
        console.error('\nQUALITY REGRESSION: average score(s) fell below the configured threshold.');
        process.exit(1);
    }
    console.log('\nOK: all scores at or above threshold.');
    process.exit(0);
}

main().catch(console.error);
