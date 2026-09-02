/**
 * Pure helpers for the pre-call survey → generated tour plan (Görev #7).
 * Shared between the API (question loop, plan finalize) and the agent-worker
 * (running the plan as this session's playbook). No I/O, no LLM.
 */

const MAX_SURVEY_QUESTIONS = 7;
const MAX_PLAN_STEPS = 8;
const Q_MAX = 300;
const A_MAX = 1000;
const COVERAGE_MAX = 400;
const NARRATION_MAX = 1200;

const str = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);

/**
 * Normalise + bound the answers list the client sends back each round.
 * @param {Array<{q?:string,a?:string}>} answers
 * @returns {Array<{q:string,a:string}>}
 */
export function clampSurveyAnswers(answers) {
    return (Array.isArray(answers) ? answers : [])
        .map((x) => ({ q: str(x?.q, Q_MAX), a: str(x?.a, A_MAX) }))
        .filter((x) => x.a)
        .slice(0, MAX_SURVEY_QUESTIONS + 2); // defensive headroom over the hard cap
}

/**
 * Hard stop for the question loop, regardless of what the LLM wants — the LLM's
 * own "I understand enough" signal ends it earlier.
 * @param {Array<{q?:string,a?:string}>} answers
 */
export function surveyShouldStop(answers) {
    return clampSurveyAnswers(answers).length >= MAX_SURVEY_QUESTIONS;
}

/**
 * Validate + bound an LLM-produced tour plan. Critically, enforces
 * `agent.screenModes`: a voice-only agent's plan carries NO page URLs.
 *
 * @param {{ screenMode?:string, steps?:Array<{url?:string,coverage?:string,narration?:string}> }} plan
 * @param {{ siteMapUrls?:Iterable<string>, canShowScreen?:boolean }} opts
 * @returns {{ screenMode:'guided-tour'|'voice-only', steps:Array<{url:string|null,coverage:string,narration:string}> }|null}
 */
export function sanitizeGeneratedPlan(plan, { siteMapUrls, canShowScreen = false } = {}) {
    const allowed = siteMapUrls instanceof Set ? siteMapUrls : new Set(siteMapUrls || []);
    const screenMode = canShowScreen ? 'guided-tour' : 'voice-only';

    const steps = (Array.isArray(plan?.steps) ? plan.steps : [])
        .map((s) => {
            const coverage = str(s?.coverage, COVERAGE_MAX);
            const narration = str(s?.narration, NARRATION_MAX);
            let url = null;
            if (canShowScreen && typeof s?.url === 'string') {
                const u = s.url.trim();
                if (u && allowed.has(u)) url = u;
            }
            return { url, coverage, narration };
        })
        .filter((s) => s.coverage || s.narration)
        .slice(0, MAX_PLAN_STEPS);

    if (!steps.length) return null;
    return { screenMode, steps };
}

/**
 * A sanitized plan → playbook nodes the agent-worker's cursor/runtime can run.
 * The generated plan IS the session's playbook; `narration` (pre-written) rides
 * along so the model delivers it instead of composing from scratch.
 *
 * @param {{ steps:Array<{url:string|null,coverage:string,narration:string}> }} plan
 * @returns {Array<{id:string,order:number,url:string|null,directive:string,narration:string|null,attach:null,mode:'important'}>}
 */
export function planToPlaybookNodes(plan) {
    return (plan?.steps || []).map((s, i) => ({
        id: `pre_${i}`,
        order: i,
        url: s.url ?? null,
        directive: s.coverage || s.narration || '',
        narration: s.narration || null,
        attach: null,
        mode: 'important'
    }));
}

export { MAX_SURVEY_QUESTIONS, MAX_PLAN_STEPS };
