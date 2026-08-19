import { getLLM } from '@repo/ai';
import { Logger } from '@repo/logger';

/**
 * The reviewer stage: reads a candidate cluster and decides what is actually
 * wrong with it, if anything.
 *
 * This is where the verdict is made, not in the clustering — embeddings put
 * "the price is 500" and "the price is 750" almost on top of each other
 * (measured 0.947), so only a reader comparing the claims can tell a harmless
 * reword from a contradiction that will make the agent state a wrong price to
 * a customer.
 *
 * Every function here returns proposals. Nothing it produces touches the
 * vector store until a person approves it.
 */

/**
 * Bulk work, so it runs on a cheap model by default rather than the
 * conversational one. Both providers ignore a model id that isn't theirs, so
 * this stays correct if the fallback chain switches provider mid-run.
 */
const AUDIT_MODEL = () => process.env.KNOWLEDGE_AUDIT_MODEL || 'gpt-4o-mini';

/**
 * Per-attempt timeout for a review call.
 *
 * Well above getLLM()'s 10s conversational default: an eight-chunk group with
 * a fact list per chunk was measured at 20s, and under the default both
 * attempts were cancelled by the clock, reported as "all providers failed",
 * and the group was silently dropped from the audit — findings quietly going
 * missing rather than anything looking broken.
 */
const AUDIT_TIMEOUT_MS = () => Number(process.env.KNOWLEDGE_AUDIT_TIMEOUT_MS || 60_000);

/** How many chunks the junk scan judges per call. */
export const JUNK_BATCH_SIZE = 20;

/** Chunk text is truncated before being sent — the verdict never needs the tail. */
const MAX_CHUNK_CHARS = 900;

const REVIEW_SYSTEM = `You audit a product knowledge base used by an AI sales agent.

You are given a group of knowledge chunks that a similarity search flagged as
talking about the same thing.

STEP 1. For each chunk, list the concrete facts it states (prices, limits,
capabilities, dates, contact details, named features). Put this in "facts" as
one array of short strings per chunk, in the order the chunks were given.
At most 5 facts per chunk, at most 8 words each — this is a working note, not
a summary, and an over-long one costs you the well-formed JSON below.

STEP 2. Compare those fact lists and choose the verdict:

- "contradiction": two chunks state INCOMPATIBLE values for the SAME subject —
  a different price, limit, date, or availability for the same thing. An agent
  using this knowledge would tell different customers different things.
- "duplicate": the fact lists are equivalent. Wording differs, information does not.
- "fine": anything else. Related subject matter, but each chunk carries
  something the others do not.

THE SUBSUMPTION TEST, which decides between "duplicate" and "fine":
If ANY chunk states even one fact that the chunk you would keep does not also
state, the verdict is "fine" — NOT "duplicate". A general sentence and a
sentence detailing it are "fine": the detail would be lost. Only answer
"duplicate" when one chunk fully covers every fact in all the others.

Further rules:
- Judge only what the text says. Never use outside knowledge about the product.
- Numbers, units and currencies differing for the SAME subject is a
  contradiction, not a duplicate. This is the most important call you make.
- Different subjects with different numbers (two pricing tiers) is "fine".
- For "duplicate", "keep" is the chunk that covers every fact in the group.
- For "contradiction", "keep" is the chunk from the most recently updated or
  most authoritative source, and the rationale must say why — never silently
  guess which value is correct.
- "canonicalText" is an optional single replacement covering the whole group.
  Use null when no single text can honestly replace them (for example a
  contradiction you cannot resolve from the text alone).
- Write "summary", "rationale" and "canonicalText" in the SAME LANGUAGE as the
  chunks you were given. If the chunks are Turkish, write Turkish.

Respond ONLY with valid JSON, no markdown:
{"facts":[["fact","fact"],["fact"]],"verdict":"contradiction"|"duplicate"|"fine","summary":"one line","rationale":"why","keep":<index or null>,"canonicalText":"..."|null}`;

const JUNK_SYSTEM = `You audit a product knowledge base used by an AI sales agent.

These chunks were cut from crawled web pages at a fixed length, so a chunk
routinely BEGINS with a navigation menu, a cart widget or a cookie banner and
then continues into real content. You must judge the WHOLE chunk, not its
opening words.

Flag a chunk ONLY when the ENTIRE chunk is boilerplate: navigation menus,
cookie/consent banners, cart and login widgets, headers and footers, tables of
contents, page numbers, "click here"/"read more" fragments, copyright lines,
or text so truncated it means nothing.

Do NOT flag a chunk if ANY part of it states something a customer could ask
about: a product name, a price, a size, a material, a feature, a benefit, a
policy, a delivery time, an ordering step, contact details, opening hours.
A product listing with prices is knowledge. An ordering instruction is
knowledge. A feature list is knowledge. Menu text sitting in front of any of
those does not make the chunk junk.

For every chunk you flag, quote its first five words in "quote". If you cannot
quote it, you did not read it, and you must not flag it.

When unsure, do not flag. Wrongly removing knowledge silently takes away the
agent's ability to answer and nobody will notice.

Respond ONLY with valid JSON, no markdown. "reason" must describe that
specific chunk, never a generic label:
{"junk":[{"index":0,"quote":"...","reason":"..."}]}`;

/** Strips ``` fences some models add despite being told not to. */
function parseJson(text) {
    const cleaned = String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    return JSON.parse(cleaned);
}

/**
 * True when `quote` really is the opening of `text`. Compared on the first few
 * words with whitespace and case normalised, since models re-space and re-case
 * quotes freely; the point is proof of reading, not a literal match.
 */
function quoteMatches(quote, text) {
    if (typeof quote !== 'string' || !quote.trim()) return false;
    const words = (s) =>
        s
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean);
    const quoted = words(quote).slice(0, 5);
    if (!quoted.length) return false;
    return words(text).slice(0, 12).join(' ').includes(quoted.join(' '));
}

/** Renders one chunk with the provenance the reviewer needs to pick a winner. */
function renderChunk(chunk, index) {
    const source = chunk.sourceTitle || chunk.sourceType || 'unknown source';
    const updated = chunk.sourceUpdatedAt
        ? new Date(chunk.sourceUpdatedAt).toISOString().slice(0, 10)
        : 'unknown date';
    return `[${index}] (source: ${source}, updated: ${updated})\n${chunk.text.slice(0, MAX_CHUNK_CHARS)}`;
}

/**
 * Judges one candidate cluster.
 *
 * @param {Array<{id:string, text:string, sourceTitle?:string, sourceType?:string, sourceUpdatedAt?:Date, audience?:string}>} chunks
 * @returns {Promise<null|{verdict:'duplicate'|'contradiction', summary:string, rationale:string, keepChunkId:string|null, canonicalText:string|null}>}
 *   null when the group is fine, or when the reviewer's answer was unusable —
 *   a finding is only ever created from an answer we could fully understand.
 */
export async function reviewCluster(chunks) {
    if (!chunks || chunks.length < 2) return null;

    let parsed;
    try {
        const response = await getLLM().complete({
            model: AUDIT_MODEL(),
            timeoutMs: AUDIT_TIMEOUT_MS(),
            system: REVIEW_SYSTEM,
            messages: [{ role: 'user', content: chunks.map(renderChunk).join('\n\n') }]
        });
        parsed = parseJson(response.text);
    } catch (err) {
        Logger.warn({ error: err?.message }, '[audit] cluster review failed (skipped)');
        return null;
    }

    if (parsed?.verdict !== 'duplicate' && parsed?.verdict !== 'contradiction') return null;

    // An out-of-range or missing index must not silently become chunks[0] —
    // "keep" decides which text survives, so an invented one is worse than none.
    const keepIndex = Number.isInteger(parsed.keep) ? parsed.keep : -1;
    const keepChunkId = keepIndex >= 0 && keepIndex < chunks.length ? chunks[keepIndex].id : null;

    const canonicalText =
        typeof parsed.canonicalText === 'string' && parsed.canonicalText.trim()
            ? parsed.canonicalText.trim()
            : null;

    // Nothing to apply: no chunk to keep and no replacement text would leave a
    // finding that can only delete knowledge.
    if (!keepChunkId && !canonicalText) return null;

    return {
        verdict: parsed.verdict,
        summary: String(parsed.summary || '').slice(0, 300) || 'Review finding',
        rationale: String(parsed.rationale || '').slice(0, 1000),
        keepChunkId,
        canonicalText
    };
}

/**
 * Flags chunks that carry no product knowledge at all. Batched — one call per
 * JUNK_BATCH_SIZE chunks rather than one per chunk.
 *
 * @param {Array<{id:string, text:string}>} chunks
 * @returns {Promise<Array<{chunkId:string, reason:string}>>}
 */
export async function reviewJunkBatch(chunks) {
    if (!chunks?.length) return [];

    let parsed;
    try {
        const numbered = chunks
            .map((c, i) => `[${i}] ${c.text.slice(0, MAX_CHUNK_CHARS)}`)
            .join('\n\n');
        const response = await getLLM().complete({
            model: AUDIT_MODEL(),
            timeoutMs: AUDIT_TIMEOUT_MS(),
            system: JUNK_SYSTEM,
            messages: [{ role: 'user', content: numbered }]
        });
        parsed = parseJson(response.text);
    } catch (err) {
        Logger.warn({ error: err?.message }, '[audit] junk review failed (skipped)');
        return [];
    }

    if (!Array.isArray(parsed?.junk)) return [];

    return parsed.junk
        .filter((entry) => Number.isInteger(entry?.index) && chunks[entry.index])
        // The quote is a read-receipt: a model that cannot reproduce the
        // chunk's opening words is labelling it from the batch's general
        // shape rather than from its content.
        .filter((entry) => quoteMatches(entry.quote, chunks[entry.index].text))
        .map((entry) => ({
            chunkId: chunks[entry.index].id,
            reason: String(entry.reason || '').slice(0, 300)
        }));
}
