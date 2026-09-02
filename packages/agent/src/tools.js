import { retrieve } from '@repo/rag';

/** Bound on how many find_page candidates are returned per call — keeps the tool result small/scannable for the model. */
const MAX_FIND_PAGE_CANDIDATES = 5;
/** Same bound, for find_element's candidates. */
const MAX_FIND_ELEMENT_CANDIDATES = 5;

// .toLocaleLowerCase('tr') (not the locale-blind .toLowerCase()) — plain
// toLowerCase() maps 'İ' to 'i̇' (i + a combining dot above, U+0307) under
// the default English casing rules, which then fails to match a plain typed
// 'i'; Turkish casing rules map 'İ' to a plain 'i' instead, as expected for
// the site content and queries this searches, which are predominantly
// Turkish.
function tokenize(text) {
    return text
        .toLocaleLowerCase('tr')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3);
}

/**
 * Two words "mention" each other if they share a leading substring — a
 * cheap stand-in for stemming that tolerates Turkish's agglutinative
 * suffixes (e.g. "çözüm"/"çözümler"/"çözümlerimiz" all share "çözü").
 * Words shorter than the prefix length must match exactly instead (a 3-char
 * word sharing a 3-char prefix with anything is just equality).
 */
function wordsMention(a, b) {
    const PREFIX_LEN = 4;
    const len = Math.min(a.length, b.length, PREFIX_LEN);
    return a.slice(0, len) === b.slice(0, len);
}

/**
 * Whether `text` mentions any of `queryWords` — the model's `query` is a
 * short natural-language DESCRIPTION ("Cyberverse ana sayfa veya ürün genel
 * bakış sayfası"), not a literal label, so a plain `label.includes(query)`
 * check (the original implementation) essentially never matches: no crawled
 * label/URL is ever long enough to literally contain the whole sentence.
 * Comparing tokenized words in both directions is what actually finds real
 * candidates — confirmed against a real crawl where the old check returned
 * zero candidates for every query the model actually sent.
 *
 * @param {string} text
 * @param {string[]} queryWords
 */
function textMentions(text, queryWords) {
    const textWords = tokenize(text);
    return textWords.some((tw) => queryWords.some((qw) => wordsMention(tw, qw)));
}

/**
 * Searches `siteMap` (see agent-worker's `runSession()` — flattened
 * `KnowledgeSource.meta.crawlIndex.pages` for the product's url/api
 * sources, see `apps/worker-ingestion/src/extractors/url.js`) for pages and
 * buttons/links whose text mentions `query`. Plain word-overlap matching, no
 * LLM — this only needs to narrow down a handful of real candidates for
 * `navigate_to`/`click_element` to then act on, not rank them precisely.
 *
 * @param {{url:string, parentUrl:string|null, links:{label?:string, targetUrl:string, kind?:string}[]}[]} siteMap
 * @param {string} query
 */
function searchSiteMap(siteMap, query) {
    const queryWords = tokenize(query);
    if (!queryWords.length) return [];
    const results = new Map(); // targetUrl -> candidate, de-duplicated

    for (const page of siteMap) {
        if (textMentions(page.url, queryWords) && !results.has(page.url)) {
            results.set(page.url, { url: page.url });
        }
        for (const link of page.links || []) {
            const label = link.label || '';
            if (textMentions(label, queryWords) && link.targetUrl && !results.has(link.targetUrl)) {
                results.set(link.targetUrl, {
                    url: link.targetUrl,
                    label,
                    kind: link.kind,
                    foundOnPage: page.url
                });
            }
        }
    }

    return [...results.values()].slice(0, MAX_FIND_PAGE_CANDIDATES);
}

/**
 * Searches `siteMap`'s per-page `components` (see `extractPageComponents()`
 * in `apps/worker-ingestion/src/extractors/url.js`) for a clickable/
 * highlightable element whose label mentions `query` — the in-page
 * counterpart to `searchSiteMap()` above (that resolves a *page*, this
 * resolves an *element on a page*). Same word-overlap matching (`textMentions()`)
 * and reasoning as `searchSiteMap()` — a literal substring check against the
 * model's full natural-language query never matches a short element label.
 *
 * `interactiveElements` already carry a ready-to-use `text=<label>` selector
 * (built at crawl time — see `extractPageComponents`). `sections` don't (a
 * `<section>`/`<form>` isn't itself clickable in the same sense), so only
 * ones with an `aria-label` are surfaced, using a `[aria-label="..."]`
 * selector — a proper attribute selector, more reliable for a whole
 * container than a `text=` substring match would be.
 *
 * @param {{url:string, components?:{interactiveElements?:{label:string,kind:string,selector:string}[], sections?:{tag:string,ariaLabel:string|null}[]}}[]} siteMap
 * @param {string} query
 */
function searchSiteElements(siteMap, query) {
    const queryWords = tokenize(query);
    if (!queryWords.length) return [];
    const results = [];
    // Some elements (e.g. a badge in a shared header/footer) repeat with the
    // exact same selector on every page — real crawl data showed this alone
    // can fill the whole candidate cap, crowding out page-specific matches.
    // Dedup by selector globally so each distinct element only counts once.
    const seenSelectors = new Set();

    for (const page of siteMap) {
        for (const el of page.components?.interactiveElements || []) {
            if (textMentions(el.label, queryWords) && !seenSelectors.has(el.selector)) {
                seenSelectors.add(el.selector);
                results.push({ pageUrl: page.url, selector: el.selector, kind: el.kind, label: el.label });
            }
        }
        for (const section of page.components?.sections || []) {
            if (section.ariaLabel && textMentions(section.ariaLabel, queryWords)) {
                const selector = `[aria-label="${section.ariaLabel}"]`;
                if (!seenSelectors.has(selector)) {
                    seenSelectors.add(selector);
                    results.push({ pageUrl: page.url, selector, kind: 'section', label: section.ariaLabel });
                }
            }
        }
        if (results.length >= MAX_FIND_ELEMENT_CANDIDATES) break;
    }

    return results.slice(0, MAX_FIND_ELEMENT_CANDIDATES);
}

/**
 * Builds the tool set exposed to the LLM for a given session. The handlers are
 * wired by the agent-worker (it owns the GuidedTour + screen track). Here we
 * define the schema + the knowledge tool that only needs productId.
 *
 * `advance_step` is only INCLUDED when `playbookActive` — not just described
 * differently, actually omitted from the tool list — when no playbook is
 * running. Its description ("Call this the moment you have finished saying
 * everything you were just asked to cover") reads as generically applicable
 * to ANY finished explanation, playbook or not; a real session log showed
 * the model calling it in free-form conversation purely off that
 * description, with no playbook telling it to. The handler then no-ops
 * (`playbookRuntime` is null) but still returns `{ok:true}`, which reads to
 * the model as "the system will handle what's next" — reinforcing exactly
 * the passive, wait-for-the-customer behavior this was supposed to avoid.
 * Removing the tool's presence in that mode is the only way to stop the
 * model from reaching for it at all — a system-prompt rule can't override a
 * tool the model can see and whose description matches what it just did.
 *
 * `next_participant` is likewise only INCLUDED when `multiParticipant` — it
 * moves the floor to the next visitor with a raised hand, which is meaningless
 * (and a passivity trap, like `advance_step`) in a 1-on-1 call.
 *
 * @param {{ productId:string, tour?:object, screen?:object, stopScreenShare?:Function, saveContactInfo?:Function, advanceStep?:Function, siteMap?:object[], playbookActive?:boolean, multiParticipant?:boolean, expectResponse?:Function, nextParticipant?:Function, flagFollowup?:Function }} ctx
 */
export function buildTools({
    productId,
    tour,
    screen,
    stopScreenShare,
    saveContactInfo,
    advanceStep,
    siteMap = [],
    playbookActive = false,
    multiParticipant = false,
    expectResponse,
    nextParticipant,
    flagFollowup
}) {
    const tools = [
        {
            name: 'search_knowledge',
            description:
                "Look up a verified fact about the product before answering — silent, the visitor never hears about this. A result may include `pageUrl` — the real page this fact was crawled from. When you want to SHOW something a result just told you about, prefer navigating straight to its `pageUrl` over guessing via find_page: it's a genuine content match, not a guess from a nav label (nav labels are often generic/marketing wording that has nothing to do with what's actually on the page). A result may also include `tabLabel` — that content lives behind a specific tab/panel selector on that page, not on the page's default view; after navigating to `pageUrl`, use `find_element` for that `tabLabel` text and `click_element` it before expecting to see this on screen.",
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    topK: { type: 'number' }
                },
                required: ['query']
            },
            handler: async ({ query, topK = 8 }) => {
                const chunks = await retrieve({ productId, query, topK });
                // `pageUrl` (from a url/api crawl segment's metadata) is the
                // single most reliable "where do I show this" signal we
                // have — real DB testing found nav-link labels are often
                // unrelated marketing wording (e.g. a link labeled
                // "Referanslar" led to the page actually covering ISO
                // certifications), which made find_page's label-matching
                // fail for exactly the queries a visitor would ask. This
                // is the RAG match itself telling us the real source page,
                // no extra lookup needed. Omitted (not `pageUrl: undefined`)
                // when absent — e.g. topic-doc-sourced chunks have no single
                // source page — so the model isn't tempted to navigate_to
                // "undefined".
                return chunks.map((c) => ({
                    text: c.text,
                    score: c.score,
                    sourceId: c.sourceId,
                    ...(c.metadata?.pageUrl && { pageUrl: c.metadata.pageUrl }),
                    // Set when this chunk came from a same-page tab/panel
                    // variant (see discoverTabVariants in worker-ingestion) —
                    // real testing found a page can have its default-shown
                    // tab reported as "content not visible" by read_tour_screen
                    // even though search_knowledge just found this exact fact
                    // on that page, because it's actually behind a DIFFERENT
                    // tab than whichever one happened to be showing. Omitted
                    // (not `tabLabel: undefined`) when the chunk isn't
                    // tab-scoped, same convention as `pageUrl` above.
                    ...(c.metadata?.tabLabel && { tabLabel: c.metadata.tabLabel })
                }));
            }
        },
        {
            name: 'start_guided_tour',
            description: 'Open the live product dashboard to visually demonstrate it.',
            parameters: {
                type: 'object',
                properties: { url: { type: 'string' } }
            },
            handler: async ({ url }) => tour?.openAt?.(url) ?? { ok: false }
        },
        {
            name: 'navigate_to',
            description: 'Navigate the shown dashboard to a specific page/URL.',
            parameters: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url']
            },
            handler: async ({ url }) => tour?.goto?.(url) ?? { ok: false }
        },
        {
            name: 'find_page',
            description:
                "Look up the real URL and button/link label for a page or site section by what it's about (e.g. \"iletişim\", \"fiyatlandırma\") — call this BEFORE navigate_to/click_element whenever you're not already certain of the exact URL/selector, instead of guessing. Returns real candidates found while the site was crawled, not a guess.",
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query']
            },
            handler: async ({ query }) => ({ candidates: searchSiteMap(siteMap, query) })
        },
        {
            name: 'find_element',
            description:
                "Look up the real selector for a specific button/link/form on a page by what it's about (e.g. \"fiyatlandırma butonu\", \"iletişim formu\") — call this BEFORE click_element/highlight whenever you're not already certain of the exact selector, instead of guessing one. find_page resolves a PAGE; this resolves an ELEMENT on a page. Returns real candidates found while the site was crawled, each tied to the page it's on.",
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query']
            },
            handler: async ({ query }) => ({ candidates: searchSiteElements(siteMap, query) })
        },
        {
            name: 'highlight',
            description: 'Highlight an element on the shown dashboard so the customer can follow.',
            parameters: {
                type: 'object',
                properties: { selector: { type: 'string' } },
                required: ['selector']
            },
            handler: async ({ selector }) => tour?.highlight?.(selector) ?? { ok: false }
        },
        {
            name: 'click_element',
            description:
                'Click an element on the shown dashboard (buttons, nav links). Use a Playwright selector; prefer visible-text selectors like "text=Ücretler" for links and buttons.',
            parameters: {
                type: 'object',
                properties: { selector: { type: 'string' } },
                required: ['selector']
            },
            handler: async ({ selector }) => tour?.click?.(selector) ?? { ok: false }
        },
        {
            name: 'scroll_page',
            description:
                'Scroll the shown dashboard to reveal content above or below the fold. Use this when the answer is further down the page, when the customer asks what else is there, or before reading the screen again. You can also provide a target section name or heading to scroll directly to it. Returns visible headings and whether the page is at the top or bottom.',
            parameters: {
                type: 'object',
                properties: {
                    direction: {
                        type: 'string',
                        enum: ['down', 'up', 'top', 'bottom'],
                        description: "'down'/'up' move by screens; 'top'/'bottom' jump to either end. Defaults to 'down'."
                    },
                    amount: {
                        type: 'number',
                        description: "How many screens to move for 'down'/'up'. Defaults to 1."
                    },
                    target: {
                        type: 'string',
                        description: "Optional section heading, topic, or selector to scroll into view (e.g. 'pricing', 'features', 'text=Fiyatlandırma')."
                    }
                }
            },
            handler: async ({ direction, amount, target }) => tour?.scroll?.(direction, amount, target) ?? { ok: false }
        },
        {
            name: 'read_customer_screen',
            description: "Look at the customer's shared screen to guide their next action.",
            parameters: {
                type: 'object',
                properties: { question: { type: 'string' } }
            },
            handler: async ({ question }) => screen?.read?.(question) ?? { ok: false }
        },
        {
            name: 'stop_screen_share',
            description:
                'Stop showing the screen (closes an active guided tour demo, and/or asks the customer to stop sharing their own screen). Call this whenever the customer asks to close, hide, or stop the screen share.',
            parameters: { type: 'object', properties: {} },
            handler: async () => stopScreenShare?.() ?? { ok: false }
        },
        {
            name: 'read_tour_screen',
            description:
                "Look at the current guided-tour page you're driving (charts, numbers, table contents, anything not conveyed by clicking/highlighting) to answer a question about what's actually on screen right now. Don't call this in the same breath as `start_guided_tour`/`navigate_to` — the frame isn't ready yet right after those, so say your one-line transition filler first instead. If it comes back with an error (no frame yet), don't immediately retry with the same question — talk about something else for a moment, then try once more later; a tight retry loop is worse than a short pause.",
            parameters: {
                type: 'object',
                properties: { question: { type: 'string' } }
            },
            handler: async ({ question }) => tour?.readScreen?.(question) ?? { ok: false }
        },
        {
            name: 'save_contact_info',
            description:
                'Save a confirmed piece of contact info (name, email, or phone). Call this ONLY after reading the value back out loud to the visitor and receiving their explicit confirmation that it is correct — never before. Call once per field, right after it is confirmed.',
            parameters: {
                type: 'object',
                properties: {
                    field: { type: 'string', enum: ['name', 'email', 'phone'] },
                    value: { type: 'string' }
                },
                required: ['field', 'value']
            },
            handler: async ({ field, value }) => saveContactInfo?.(field, value) ?? { ok: false }
        },
        {
            name: 'expect_response',
            description:
                "Call this the moment you ask the visitor something that genuinely needs a real answer (e.g. confirming a piece of contact info) — nowhere else. It gives them a real few seconds to actually respond instead of you continuing on your own almost immediately, which is what normally happens after you finish speaking. Do not call this for anything else — you are told never to ask the visitor what to do next in the first place, so this should be rare.",
            parameters: { type: 'object', properties: {} },
            handler: async () => expectResponse?.() ?? { ok: false }
        },
        {
            name: 'flag_followup_needed',
            description:
                "Call this ONLY after the visitor has explicitly said yes to having an unanswered question forwarded to the team — never before they agree, and never as a substitute for search_knowledge. Pass a short, clear version of their question.",
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string' }
                },
                required: ['question']
            },
            handler: async ({ question }) => flagFollowup?.(question) ?? { ok: false }
        }
    ];

    if (multiParticipant) {
        tools.push({
            name: 'next_participant',
            description:
                "Group session only. Call this ONCE you have fully answered whoever currently has the floor AND they have confirmed they have nothing else — it hands the floor to the next visitor who raised their hand and returns their name (or {next:null} if nobody is waiting). NEVER call it while the current person still has questions, or while others are actively discussing the current topic.",
            parameters: { type: 'object', properties: {} },
            handler: async () => nextParticipant?.() ?? { ok: false }
        });
    }

    if (playbookActive) {
        tools.push({
            name: 'advance_step',
            description:
                'Call this the moment you have finished saying everything you were just asked to cover. Judge only the sentence you just spoke — do not try to track or reason about any larger plan.',
            parameters: { type: 'object', properties: {} },
            handler: async () => advanceStep?.() ?? { ok: false }
        });
    }

    return tools;
}
