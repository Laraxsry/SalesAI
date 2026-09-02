import { getLLM } from './llm/index.js';

/**
 * Site Bilgisi map-reduce (see md plan "Site Bilgisi Derinleştirme"):
 *  1. Map (`classifyPageTopics`) — one crawled page -> which fixed/proposed
 *     topics it contributes to, and what it says (raw findings, not
 *     interpreted prose — that happens in the reduce step below).
 *  2. `dedupeProposedTopics` — clusters this run's site-specific topic
 *     proposals (across all pages) into a small set of new topics.
 *  3. Reduce (`composeTopicDocument`) — ALL findings that landed on one
 *     topic, across every page that contributed to it, composed into one
 *     long, coherent markdown document.
 *
 * Deliberately separate LLM passes from `synthesize.js`'s per-page
 * paragraph (not folded into the same call) — a page's short interpretive
 * summary and its structured topic findings serve different purposes, and
 * combining them risks shortchanging both in one response. Same non-fatal
 * posture throughout as the rest of the ingestion pipeline: a failure here
 * never blocks the crawl, it just means that page/topic falls back to
 * "no contribution this run" instead of failing ingestion outright.
 */

/** Starter taxonomy every product gets seeded with at first crawl (see ingest-source.js). */
export const FIXED_TOPICS = [
    { slug: 'iletisim', title: 'İletişim' },
    { slug: 'hakkimizda', title: 'Hakkımızda (Vizyon, Misyon, Değerler)' },
    { slug: 'urun-hizmetler', title: 'Ürün / Hizmetler' },
    { slug: 'fiyatlandirma', title: 'Fiyatlandırma' },
    { slug: 'sss', title: 'Sıkça Sorulan Sorular' },
    { slug: 'referanslar', title: 'Referanslar / Müşteriler' },
    { slug: 'kariyer', title: 'Kariyer' },
    { slug: 'blog-haberler', title: 'Blog / Haberler' },
    { slug: 'destek-yardim', title: 'Destek / Yardım' },
    { slug: 'yasal', title: 'Yasal (KVKK / Gizlilik)' }
];

const MAX_PAGE_CHARS = Number(process.env.SITE_TOPICS_MAP_PAGE_CHARS || 6000);
const MAX_FINDING_CHARS = Number(process.env.SITE_TOPICS_MAX_FINDING_CHARS || 4000);

function truncate(text, max) {
    return text.length > max ? text.slice(0, max) : text;
}

/**
 * Map phase: classifies one crawled page's raw text against the fixed
 * taxonomy, and captures any content that doesn't fit as a proposed
 * site-specific topic instead of forcing it into a fixed slot. A single
 * page can contribute to several topics at once (e.g. a footer that has
 * both contact info and a legal notice).
 *
 * @param {{ pageUrl:string, pageText:string, fixedTopics?:{slug:string,title:string}[], language?:string }} input
 * @returns {Promise<{ findings: Array<{topicSlug?:string, proposedTopic?:string, text:string}> }>}
 */
export async function classifyPageTopics({ pageUrl, pageText, fixedTopics = FIXED_TOPICS, language = 'English' }) {
    if (!pageText?.trim()) return { findings: [] };
    try {
        const topicList = fixedTopics.map((t) => `- ${t.slug}: ${t.title}`).join('\n');
        const llm = getLLM(undefined, { timeoutMs: 30_000 });
        const response = await llm.complete({
            model: 'gpt-4o-mini',
            system: `You extract raw findings from one crawled web page for a sales assistant's structured knowledge base. Fixed topics available:
${topicList}

For every distinct piece of concrete information on this page (facts, contact details, prices, policies, claims — not filler/navigation text), emit one finding:
- If it clearly belongs to one of the fixed topics above, set "topicSlug" to its EXACT slug from the list.
- If it doesn't fit any of them, set "proposedTopic" to a short (2-5 word) topic name for it instead — do not force-fit content into the wrong fixed topic.
"text" must be the RAW information itself (facts/quotes/numbers), not an interpretation or summary — a later step composes the final prose from this.

Respond ONLY with valid JSON (no markdown): {"findings": [{"topicSlug": "...", "text": "..."} | {"proposedTopic": "...", "text": "..."}]}
A page with nothing worth extracting (pure navigation/boilerplate) should return {"findings": []}. Respond with findings written in ${language}.`,
            messages: [{ role: 'user', content: `Page URL: ${pageUrl}\n\nContent:\n${truncate(pageText, MAX_PAGE_CHARS)}` }]
        });
        const parsed = JSON.parse(response.text);
        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        return {
            findings: findings
                .filter((f) => f?.text && (f.topicSlug || f.proposedTopic))
                .map((f) => ({
                    topicSlug: f.topicSlug || undefined,
                    proposedTopic: f.proposedTopic || undefined,
                    text: truncate(String(f.text), MAX_FINDING_CHARS)
                }))
        };
    } catch {
        return { findings: [] };
    }
}

/**
 * Clusters this run's site-specific topic proposals (collected across every
 * page's `classifyPageTopics()` call) into a small set of deduplicated new
 * topics — without this, "İletişim Bilgileri", "Bize Ulaşın" and "Contact"
 * proposed independently on three different pages would become three
 * separate (redundant) topics instead of one. Uses the same index -> real-ID
 * mapping pattern as the GAP analysis's map-reduce (see
 * apps/worker-general/src/handlers/analyze-knowledge-gaps.js) so the LLM
 * only ever has to reference small integers, not free-form text matching.
 *
 * Skips the LLM call entirely when there's nothing to cluster (0 proposals)
 * or nothing to dedupe (exactly 1) — a single proposal is trivially its own
 * group.
 *
 * @param {{proposedTopic:string}[]} proposals - in the SAME order the caller will map results back by index.
 * @param {string} [language]
 * @returns {Promise<{index:number, slug:string, title:string}[]>} one entry per input proposal, resolved to its (possibly shared) new topic.
 */
export async function dedupeProposedTopics(proposals, language = 'English') {
    if (!proposals.length) return [];
    const toSlug = (title) =>
        title
            .toLowerCase()
            .replace(/[^a-z0-9ığüşöç\s-]/gi, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 60) || 'konu';

    if (proposals.length === 1) {
        return [{ index: 0, slug: toSlug(proposals[0].proposedTopic), title: proposals[0].proposedTopic }];
    }

    const numbered = proposals.map((p, i) => `[${i}] ${p.proposedTopic}`).join('\n');
    try {
        const llm = getLLM(undefined, { timeoutMs: 30_000 });
        const response = await llm.complete({
            model: 'gpt-4o-mini',
            system: `You deduplicate a list of numbered, loosely-worded topic name proposals from a website crawl into a small set of distinct topics. Group proposals that mean the same real-world subject (e.g. "İletişim Bilgileri" and "Bize Ulaşın" are the same topic) even if worded differently. Respond ONLY with valid JSON (no markdown):
{"groups": [{"indexes": [0, 2], "title": "..."}]}
Every input index must appear in EXACTLY one group. Titles in ${language}, short (2-5 words).`,
            messages: [{ role: 'user', content: numbered }]
        });
        const parsed = JSON.parse(response.text);
        const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
        const resolved = [];
        const seenIndexes = new Set();
        for (const g of groups) {
            if (!g?.title || !Array.isArray(g.indexes)) continue;
            const slug = toSlug(g.title);
            for (const i of g.indexes) {
                if (typeof i !== 'number' || seenIndexes.has(i) || !proposals[i]) continue;
                seenIndexes.add(i);
                resolved.push({ index: i, slug, title: g.title });
            }
        }
        // Any proposal the LLM dropped (malformed response, index omitted)
        // still becomes its own topic instead of silently losing that page's
        // findings — mirrors the map phase's fallback posture.
        proposals.forEach((p, i) => {
            if (!seenIndexes.has(i)) resolved.push({ index: i, slug: toSlug(p.proposedTopic), title: p.proposedTopic });
        });
        return resolved;
    } catch {
        return proposals.map((p, i) => ({ index: i, slug: toSlug(p.proposedTopic), title: p.proposedTopic }));
    }
}

/**
 * Reduce phase: composes ALL findings that landed on one topic — across
 * every page that contributed to it — into one long, coherent markdown
 * document. This (not a bigger single-page call) is what fixes the "too
 * short" complaint about `synthesizePage()`'s per-page paragraphs: a topic
 * spread across several pages (e.g. contact info in the footer AND on a
 * dedicated /contact page) gets combined here, with genuine multi-source
 * material to draw a real document from.
 *
 * @param {{ topicTitle:string, findings:{text:string, pageUrl:string}[], language?:string }} input
 * @returns {Promise<string>} markdown body, '' on failure (non-fatal — caller keeps the topic's previous body).
 */
export async function composeTopicDocument({ topicTitle, findings, language = 'English' }) {
    if (!findings.length) return '';
    try {
        const numbered = findings.map((f, i) => `[Source ${i + 1}: ${f.pageUrl}]\n${f.text}`).join('\n\n');
        const llm = getLLM(undefined, { timeoutMs: 60_000 });
        const response = await llm.complete({
            system: `You write a thorough, well-organized markdown document for one topic ("${topicTitle}") of a sales assistant's knowledge base, from raw findings gathered across multiple pages of a crawled website. Combine and reconcile the findings into flowing, comprehensive prose (use markdown headings/lists where they genuinely help readability) — this is the assistant's authoritative reference for this topic, so be complete, not terse. If two findings conflict, mention both rather than silently picking one. Cite which source page a specific claim came from only when it materially helps (e.g. pricing, dates) — don't clutter every sentence with a reference. Respond only in ${language}, with no preamble, starting directly with the content (no top-level "# ${topicTitle}" heading — the title is shown separately).`,
            messages: [{ role: 'user', content: numbered }]
        });
        return response.text?.trim() || '';
    } catch {
        return '';
    }
}
