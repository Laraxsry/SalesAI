import { getLLM } from './llm/index.js';

/**
 * Pre-call adaptive survey (Görev #7). Before a 1-on-1 demo starts, the visitor
 * answers a few AI-generated questions; the answers produce a per-visitor tour
 * plan the agent follows.
 *
 * Two LLM passes, both `gpt-4o-mini`, both non-fatal (a failure just means the
 * survey is skipped and the call falls back to the normal flow):
 *  1. `nextSurveyQuestion` — given the answers so far, either the next question
 *     or "done" + a structured read of what the visitor wants.
 *  2. `buildTourPlan` — given that intent + the product's topics/site map,
 *     an ordered plan of what to cover, with pre-written narration.
 *
 * `buildTourPlan` MUST respect `canShowScreen`: a voice-only agent's plan
 * carries no page URLs — the sanitizer (`@repo/agent`'s `sanitizeGeneratedPlan`)
 * enforces this too, but the prompt asks for it up front.
 */

const MAX_Q = 7;
const clip = (s, n) => String(s || '').slice(0, n);

function answersBlock(answers) {
    if (!answers.length) return '(no answers yet — ask the first question)';
    return answers.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join('\n\n');
}

/**
 * @param {object} input
 * @param {{name:string,description?:string}} input.product
 * @param {string[]} input.topicTitles   knowledge topic titles (the "main themes")
 * @param {Array<{url:string,title?:string}>} input.siteMap
 * @param {Array<{q:string,a:string}>} input.answers
 * @param {boolean} input.canShowScreen
 * @param {string} [input.language]
 * @returns {Promise<{done:false,question:{text:string,options:string[],allowFreeText:boolean}}|{done:true,intent:object}>}
 */
export async function nextSurveyQuestion({
    product,
    topicTitles = [],
    siteMap = [],
    answers = [],
    canShowScreen = false,
    language = 'the visitor\'s language'
}) {
    // Hard stop — the loop never exceeds MAX_Q regardless of the model.
    const forceDone = answers.length >= MAX_Q;

    const llm = getLLM(undefined, { timeoutMs: 25_000 });
    const sys = `You run a SHORT pre-demo intake for "${product.name}"${
        product.description ? ` (${clip(product.description, 300)})` : ''
    }. Goal: in at most ${MAX_Q} questions — ideally 3-4 — find out what THIS visitor actually wants from the demo, so the agent can go straight to it.

Rules:
- One question at a time. The FIRST question is a broad but product-relevant one ("What are you hoping to get out of this?" / "What problem are you trying to solve?").
- Each next question follows from the visitor's last answer — drill into their situation, role, use case, what they use today, their priority.
- Offer 2-5 concrete multiple-choice options when it helps them answer fast; still allow free text.
- STOP as soon as you can describe what they want with confidence. Do not pad to ${MAX_Q}.
- Questions and options must be written in ${language}. Keep them short.

Product themes: ${topicTitles.slice(0, 20).join(', ') || '(none)'}.
${canShowScreen ? `Pages available to demo: ${siteMap.slice(0, 25).map((p) => p.title || p.url).join(', ')}.` : 'This agent is voice-only (no screen sharing).'}

Respond ONLY with valid JSON, no markdown:
- to ask another question: {"done": false, "question": {"text": "...", "options": ["...", "..."], "allowFreeText": true}}
- when you understand enough: {"done": true, "intent": {"summary": "one sentence on what they want", "role": "...", "goal": "...", "painPoints": ["..."], "priorities": ["..."]}}`;

    const user = forceDone
        ? `Answers so far:\n${answersBlock(answers)}\n\nYou have reached the question limit. Return {"done": true, "intent": {...}} now.`
        : `Answers so far:\n${answersBlock(answers)}\n\nReturn the next question, or done+intent if you understand enough.`;

    try {
        const res = await llm.complete({ model: 'gpt-4o-mini', system: sys, messages: [{ role: 'user', content: user }] });
        const parsed = JSON.parse(res.text);
        if (forceDone || parsed?.done) {
            return { done: true, intent: parsed?.intent && typeof parsed.intent === 'object' ? parsed.intent : { summary: '' } };
        }
        const q = parsed?.question || {};
        return {
            done: false,
            question: {
                text: clip(q.text, 400),
                options: Array.isArray(q.options) ? q.options.slice(0, 5).map((o) => clip(o, 120)) : [],
                allowFreeText: q.allowFreeText !== false
            }
        };
    } catch (err) {
        // Non-fatal: end the survey, let the call proceed with whatever we have.
        console.warn('[pre-call-survey] nextSurveyQuestion failed (survey skipped):', err?.message || err);
        return { done: true, intent: { summary: '' } };
    }
}

/**
 * @param {object} input
 * @param {{name:string,description?:string}} input.product
 * @param {Array<{title:string,body?:string}>} input.topics
 * @param {Array<{url:string,title?:string}>} input.siteMap
 * @param {object} input.intent
 * @param {boolean} input.canShowScreen
 * @param {string} [input.language]
 * @returns {Promise<{screenMode:string,steps:Array<{url?:string,coverage:string,narration:string}>}|null>}
 */
export async function buildTourPlan({
    product,
    topics = [],
    siteMap = [],
    intent = {},
    canShowScreen = false,
    language = 'the visitor\'s language'
}) {
    const llm = getLLM(undefined, { timeoutMs: 45_000 });
    const themeLines = topics
        .slice(0, 25)
        .map((t) => `- ${t.title}${t.body ? `: ${clip(t.body, 240)}` : ''}`)
        .join('\n');
    const pageLines = canShowScreen
        ? siteMap.slice(0, 30).map((p) => `- ${p.url}${p.title ? ` (${p.title})` : ''}`).join('\n')
        : '';

    const sys = `You build the plan a live AI sales agent will follow for ONE visitor of "${product.name}", based on what they told you they want. Output an ordered list of 3-6 steps.

Each step:
- "coverage": what this step is about (a few words, for the agent's own reference).
- "narration": the actual words the agent will say for this step, ALREADY WRITTEN, in ${language}. 1-4 sentences. Dense and specific to THIS visitor's goal — no filler, no "let me set the stage", no agenda talk. Lead with the point.
${canShowScreen
        ? '- "url": the page to show for this step, chosen ONLY from the "Pages available" list below (exact string). Omit "url" for a pure-talk step.'
        : '- Do NOT include "url" on any step — this agent cannot share a screen.'}

Step 1's narration opens the call: one short line acknowledging what they told you they want, then straight into the first substantive point — no "welcome to a demo of X" throat-clearing.

Order the steps to get to what they care about fastest. Skip anything that does not serve this specific visitor.

Product themes:
${themeLines || '(none)'}
${canShowScreen ? `\nPages available:\n${pageLines}` : ''}

Visitor intent: ${JSON.stringify(intent)}

Respond ONLY with valid JSON, no markdown: {"steps": [{"coverage": "...", "narration": "...", "url": "..."}]}`;

    try {
        const res = await llm.complete({
            model: 'gpt-4o-mini',
            system: sys,
            messages: [{ role: 'user', content: 'Build the plan.' }]
        });
        const parsed = JSON.parse(res.text);
        if (!Array.isArray(parsed?.steps) || !parsed.steps.length) return null;
        // Shape only — @repo/agent's sanitizeGeneratedPlan does the real
        // enforcement (URL allowlist, voice-only strip, caps).
        return { screenMode: canShowScreen ? 'guided-tour' : 'voice-only', steps: parsed.steps };
    } catch (err) {
        console.warn('[pre-call-survey] buildTourPlan failed (no plan):', err?.message || err);
        return null;
    }
}

export { MAX_Q };
