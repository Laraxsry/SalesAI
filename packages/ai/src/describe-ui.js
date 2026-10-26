import { getLLM } from './llm/index.js';

const MAX_PROCEDURE_CHARS = 3000;

/**
 * One or two sentences on what a dashboard flow is FOR and when someone would want it, written from the
 * recipe text. The recipe already says how; this says why, in the words a sales assistant would use.
 * Non-fatal like synthesizePage(): any failure returns '' and the caller keeps its template wording.
 *
 * @param {{ procedureText:string, language?:string }} input
 * @returns {Promise<string>}
 */
export async function describeProcedure({ procedureText, language = 'English' }) {
    if (!procedureText?.trim()) return '';
    try {
        const llm = getLLM();
        const response = await llm.complete({
            system: `You write one or two sentences for a sales assistant's knowledge base about a flow in a product's own dashboard. Explain what the flow is for and when a user would want to do it, in plain words. Do NOT list the steps (they are given separately) and do NOT invent details that are not in the recipe. Respond only in ${language}, with no preamble.`,
            messages: [{ role: 'user', content: `Recipe:\n${procedureText.slice(0, MAX_PROCEDURE_CHARS)}` }]
        });
        return response.text?.trim() || '';
    } catch {
        return '';
    }
}

const MAX_ELEMENT_ITEMS = 20;

/**
 * One plain-language "what is this button for" sentence per button of one dashboard page, from what pressing
 * each was observed to do. A single call per page. Non-fatal: any failure, or an answer that is not the
 * expected JSON, returns {} and the caller keeps what it already has.
 *
 * @param {{ pageUrl:string, items:{label:string, observed:string}[], language?:string }} input
 * @returns {Promise<Record<string,string>>} purpose by button label
 */
export async function describeUiElements({ pageUrl, items, language = 'English' }) {
    const list = (items || []).filter((item) => item.label && item.observed).slice(0, MAX_ELEMENT_ITEMS);
    if (!list.length) return {};
    try {
        const llm = getLLM();
        const response = await llm.complete({
            system: `You write one short sentence per button of a product's own dashboard page, for a sales assistant's knowledge base: what the button is FOR, in plain words, from what pressing it was observed to do. Do not invent anything beyond the observation. Answer ONLY with a JSON array of objects {"label": "...", "purpose": "..."}, one per button, using the exact labels given. Write each purpose in ${language}.`,
            messages: [
                {
                    role: 'user',
                    content: `Page: ${pageUrl}\n\nButtons:\n${list.map((item) => `- "${item.label}": ${item.observed}`).join('\n')}`
                }
            ]
        });
        const text = response.text || '';
        const parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
        const known = new Set(list.map((item) => item.label));
        const purposes = {};
        for (const entry of Array.isArray(parsed) ? parsed : []) {
            if (known.has(entry?.label) && typeof entry.purpose === 'string' && entry.purpose.trim()) {
                purposes[entry.label] = entry.purpose.trim();
            }
        }
        return purposes;
    } catch {
        return {};
    }
}

