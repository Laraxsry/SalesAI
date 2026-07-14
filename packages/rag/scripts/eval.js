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
    } catch(e) { console.error('Failed to parse faithfulness JSON'); }

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
    } catch(e) { console.error('Failed to parse relevancy JSON'); }

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
    const llm = getLLM();
    
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

    if (results.length > 0) {
        console.log('\n=== EVALUATION REPORT ===');
        let avgF = 0, avgR = 0;
        for (const r of results) {
            console.log(`Q: ${r.question}`);
            console.log(`  Faithfulness: ${r.faithfulness} (${r.fReason})`);
            console.log(`  Relevancy:    ${r.relevancy} (${r.rReason})`);
            avgF += r.faithfulness;
            avgR += r.relevancy;
        }
        console.log(`\nAverage Faithfulness: ${avgF / results.length}`);
        console.log(`Average Relevancy:    ${avgR / results.length}`);
    }

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(console.error);
