import { getLLM } from './llm/index.js';

// Raw crawled pages can be large; a summary doesn't need the whole page to
// capture what it's about, and keeping the prompt small bounds cost/latency
// per page during a 40-page crawl.
const MAX_PAGE_CHARS = 6000;
const MAX_OVERVIEW_PAGE_CHARS = 800;

function truncate(text, max) {
    return text.length > max ? text.slice(0, max) : text;
}

/**
 * Turns one crawled page's raw text into a short interpretive paragraph —
 * what the page/section is for and what its numbers/data mean in context —
 * instead of the verbatim listing chunkText() would otherwise embed as-is.
 * Non-fatal: any failure (rate limit, malformed response) returns '' so the
 * caller can skip adding a synthesized segment for that page without
 * failing the whole ingestion, mirroring classifyAudience()'s fallback
 * posture in packages/rag/src/ingest.js.
 *
 * @param {{ pageUrl:string, pageText:string, language?:string }} input
 * @returns {Promise<string>}
 */
export async function synthesizePage({ pageUrl, pageText, language = 'English' }) {
    if (!pageText?.trim()) return '';
    try {
        const llm = getLLM();
        const response = await llm.complete({
            system: `You write a short, interpretive summary of one crawled web page for a sales assistant's knowledge base. Explain what this page/section is for and what its data means in context — don't just restate numbers or facts verbatim, interpret them (e.g. instead of "42 active users", explain what that implies about scale or usage). Write 2-4 sentences of flowing prose, not a list. Respond only in ${language}, with no preamble.`,
            messages: [
                { role: 'user', content: `Page URL: ${pageUrl}\n\nContent:\n${truncate(pageText, MAX_PAGE_CHARS)}` }
            ]
        });
        return response.text?.trim() || '';
    } catch {
        return '';
    }
}

/**
 * Produces one cross-page synthesis for an entire crawled source — how the
 * pages relate to each other and what the site/panel covers overall — so
 * retrieval has something to return for "what does this cover" style
 * questions instead of only ever surfacing single-page fragments. Same
 * non-fatal posture as synthesizePage().
 *
 * @param {{ pages:{url:string, text:string}[], language?:string }} input
 * @returns {Promise<string>}
 */
export async function synthesizeOverview({ pages, language = 'English' }) {
    const withText = pages.filter((p) => p.text?.trim());
    if (!withText.length) return '';
    try {
        const llm = getLLM();
        const joined = withText
            .map((p) => `[Page: ${p.url}]\n${truncate(p.text, MAX_OVERVIEW_PAGE_CHARS)}`)
            .join('\n\n');
        const response = await llm.complete({
            system: `You write a short overview connecting the pages of a crawled website/dashboard for a sales assistant's knowledge base. Explain what the site/product covers overall and how the listed pages relate to each other. Write 3-6 sentences of flowing prose, not a list. Respond only in ${language}, with no preamble.`,
            messages: [{ role: 'user', content: joined }]
        });
        return response.text?.trim() || '';
    } catch {
        return '';
    }
}
