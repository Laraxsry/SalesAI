import { retrieve } from '@repo/rag';
import {
    createKnowledgeResolver,
    knowledgeResolutionToToolResult
} from './knowledge-resolution.js';

/** Shared retrieval adapter for tool calls and customer-triggered replanning. */
export function createProductKnowledgeResolver() {
    return createKnowledgeResolver({
        retrieveChunks: ({ productId, query, topK, preferredAudience }) => retrieve({
            productId,
            query,
            topK,
            ...(preferredAudience === 'technical' && { preferredAudience })
        })
    });
}

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
 * @param {{url:string, components?:{interactiveElements?:{label:string,kind:string,selector:string}[], sections?:{tag:string,ariaLabel:string|null}[], toggles?:{elementKey:string,elementPath?:string,label:string,kind:string,selector:string}[]}}[]} siteMap
 * @param {string} query
 * @param {string} elementKey
 */
function searchSiteElements(siteMap, query, elementKey) {
    if (elementKey) {
        for (const page of siteMap) {
            const toggle = (page.components?.toggles || []).find((item) => item.elementKey === elementKey);
            if (toggle) {
                return [{
                    pageUrl: page.url,
                    selector: toggle.selector,
                    kind: toggle.kind || 'toggle',
                    label: toggle.label,
                    elementKey: toggle.elementKey,
                    ...(toggle.elementPath && { elementPath: toggle.elementPath })
                }];
            }
        }
        return [];
    }

    const queryWords = tokenize(query);
    if (!queryWords.length) return [];
    const results = [];
    // Some elements (e.g. a badge in a shared header/footer) repeat with the
    // exact same selector on every page — real crawl data showed this alone
    // can fill the whole candidate cap, crowding out page-specific matches.
    // Dedup by selector globally so each distinct element only counts once.
    const seenSelectors = new Set();

    for (const page of siteMap) {
        for (const toggle of page.components?.toggles || []) {
            if (textMentions(`${toggle.label} ${toggle.elementPath || ''}`, queryWords) && !seenSelectors.has(toggle.elementKey)) {
                seenSelectors.add(toggle.elementKey);
                results.push({
                    pageUrl: page.url,
                    selector: toggle.selector,
                    kind: toggle.kind || 'toggle',
                    label: toggle.label,
                    elementKey: toggle.elementKey,
                    ...(toggle.elementPath && { elementPath: toggle.elementPath })
                });
            }
        }
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
 * @param {{ productId:string, tour?:object, screen?:object, stopScreenShare?:Function, saveContactInfo?:Function, saveMeeting?:Function, advanceStep?:Function, siteMap?:object[], playbookActive?:boolean, multiParticipant?:boolean, expectResponse?:Function, nextParticipant?:Function, flagFollowup?:Function, knowledgeResolver?:object, onKnowledgeResolved?:Function }} ctx
 */
export function buildTools({
    productId,
    tour,
    screen,
    stopScreenShare,
    saveContactInfo,
    saveMeeting,
    advanceStep,
    siteMap = [],
    playbookActive = false,
    multiParticipant = false,
    expectResponse,
    nextParticipant,
    flagFollowup,
    browser,
    knowledgeResolver,
    onKnowledgeResolved,
    proposeSurvey,
    surveyFieldKeys = []
}) {
    const resolver = knowledgeResolver ?? createProductKnowledgeResolver();

    const tools = [
        {
            name: 'search_knowledge',
            description:
                "Look up a verified fact about the product before answering — silent, the visitor never hears about this. A result may include `pageUrl`, `tabLabel`, or `elementKey`. To SHOW an element-scoped fact: navigate to its pageUrl, call find_element with the exact elementKey, then click_element with that elementKey and ensureExpanded=true. Never invent an elementKey or selector.",
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    topK: { type: 'number' }
                },
                required: ['query']
            },
            handler: async ({ query, topK = 8 }) => {
                const resolution = await resolver.resolve({ productId, query, topK });
                try {
                    onKnowledgeResolved?.(resolution);
                } catch {
                    // Observability cannot change a customer-facing lookup.
                }
                if (resolution.status === 'unavailable') {
                    throw resolution.cause ?? new Error('knowledge retrieval unavailable');
                }
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
                return knowledgeResolutionToToolResult(resolution);
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
                "Resolve a crawled page element. When search_knowledge returns an elementKey, pass that exact key for deterministic lookup. Otherwise use query for fuzzy discovery. Never invent an elementKey or selector.",
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Natural-language element description for fuzzy discovery.' },
                    elementKey: { type: 'string', description: 'Exact opaque key returned by search_knowledge.' }
                }
            },
            handler: async ({ query = '', elementKey }) => ({ candidates: searchSiteElements(siteMap, query, elementKey) })
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
                'Click a shown dashboard element. Prefer an exact elementKey returned by search_knowledge/find_element; use ensureExpanded=true for accordions so an already-open item is not accidentally closed. Legacy selector clicks remain supported.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string' },
                    elementKey: { type: 'string', description: 'Exact opaque key returned by search_knowledge/find_element.' },
                    ensureExpanded: { type: 'boolean', description: 'If true, do not click an accordion that is already open.' }
                }
            },
            handler: async ({ selector, elementKey, ensureExpanded = false }) => {
                let resolvedSelector = selector;
                if (elementKey) {
                    const [match] = searchSiteElements(siteMap, '', elementKey);
                    if (!match) return { ok: false, found: false, reason: 'element_key_not_found' };
                    resolvedSelector = match.selector;
                }
                if (!resolvedSelector) return { ok: false, found: false, reason: 'selector_required' };
                if (!tour?.click) return { ok: false };
                if (elementKey || ensureExpanded) {
                    return tour.click(resolvedSelector, { ensureExpanded }) ?? { ok: false };
                }
                return tour.click(resolvedSelector) ?? { ok: false };
            }
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
                'Save a confirmed piece of contact info (name, email, phone, or company). Call this ONLY after reading the value back out loud to the visitor and receiving their explicit confirmation that it is correct — never before. Call once per field, right after it is confirmed.',
            parameters: {
                type: 'object',
                properties: {
                    field: { type: 'string', enum: ['name', 'email', 'phone', 'company'] },
                    value: { type: 'string' }
                },
                required: ['field', 'value']
            },
            handler: async ({ field, value }) => saveContactInfo?.(field, value) ?? { ok: false }
        },
        {
            name: 'save_meeting',
            description:
                'Save a follow-up meeting only after the visitor explicitly confirms the exact date, time, timezone, duration, and attendees. startsAt must be an ISO datetime with offset. Never guess a missing value.',
            parameters: {
                type: 'object',
                properties: {
                    startsAt: { type: 'string', description: 'Confirmed ISO datetime with UTC offset.' },
                    timezone: { type: 'string', description: 'Confirmed IANA timezone, e.g. Europe/Brussels.' },
                    durationMinutes: { type: 'number', minimum: 5, maximum: 480 },
                    originalPhrase: { type: 'string', description: 'The visitor\'s original scheduling phrase.' }
                },
                required: ['startsAt', 'timezone', 'durationMinutes', 'originalPhrase']
            },
            handler: async (input) => saveMeeting?.(input) ?? { ok: false }
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
                    question: { type: 'string' },
                    consentConfirmed: {
                        type: 'boolean',
                        description: 'True only after the visitor explicitly agreed to have this unanswered question forwarded.'
                    }
                },
                required: ['question', 'consentConfirmed']
            },
            handler: async ({ question, consentConfirmed }) => {
                if (consentConfirmed !== true) {
                    return { ok: false, error: 'explicit_consent_required' };
                }
                return flagFollowup?.(question, { consentToContact: true }) ?? { ok: false };
            }
        }
    ];

    // Do not advertise scheduling when the product/runtime did not grant the
    // capability; a visible no-op tool invites the model to promise outcomes
    // it cannot persist.
    if (!saveMeeting) {
        const index = tools.findIndex((entry) => entry.name === 'save_meeting');
        if (index >= 0) tools.splice(index, 1);
    }

    if (browser) {
        const replaced = new Set(['find_element', 'highlight', 'click_element', 'scroll_page']);
        for (let index = tools.length - 1; index >= 0; index -= 1) {
            if (replaced.has(tools[index].name)) tools.splice(index, 1);
        }
        tools.push(
            {
                name: 'browser_snapshot',
                description: 'Read the live page accessibility tree. Call before interacting and use only UIDs from the latest snapshot.',
                parameters: { type: 'object', properties: {} },
                handler: async () => browser.observe()
            },
            {
                name: 'browser_click',
                description: 'Click an element using a UID from the latest browser_snapshot. Observe again after state-changing clicks.',
                parameters: {
                    type: 'object',
                    properties: { uid: { type: 'string' } },
                    required: ['uid']
                },
                handler: async ({ uid }) => browser.perform('click', { uid, includeSnapshot: true })
            },
            {
                name: 'browser_focus',
                description: 'Direct the visitor\'s attention to one element without clicking it. Use a UID from the latest browser_snapshot and only when the element supports the point you are currently explaining.',
                parameters: {
                    type: 'object',
                    properties: {
                        uid: { type: 'string' },
                        intent: {
                            type: 'string',
                            enum: ['emphasize', 'text', 'panel'],
                            description: 'text draws a marker, panel uses a spotlight, emphasize uses an outline.'
                        }
                    },
                    required: ['uid']
                },
                handler: async ({ uid, intent = 'emphasize' }) => browser.focus?.(uid, intent) ?? { ok: false }
            },
            {
                name: 'browser_fill',
                description: 'Fill one input, textarea, select, checkbox, or radio using a UID from the latest snapshot.',
                parameters: {
                    type: 'object',
                    properties: { uid: { type: 'string' }, value: { type: 'string' } },
                    required: ['uid', 'value']
                },
                handler: async ({ uid, value }) => browser.perform('fill', { uid, value, includeSnapshot: true })
            },
            {
                name: 'browser_fill_form',
                description: 'Fill several visible form controls in one reliable operation. Use UIDs from the latest snapshot.',
                parameters: {
                    type: 'object',
                    properties: {
                        elements: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: { uid: { type: 'string' }, value: { type: 'string' } },
                                required: ['uid', 'value']
                            }
                        }
                    },
                    required: ['elements']
                },
                handler: async ({ elements }) => browser.perform('fillForm', { elements, includeSnapshot: true })
            },
            {
                name: 'browser_hover',
                description: 'Hover an element using a UID from the latest snapshot, for menus and hover-revealed content.',
                parameters: {
                    type: 'object', properties: { uid: { type: 'string' } }, required: ['uid']
                },
                handler: async ({ uid }) => browser.perform('hover', { uid, includeSnapshot: true })
            },
            {
                name: 'browser_press_key',
                description: 'Press a key or key chord in the live browser, such as PageDown, Escape, Tab, or Control+A.',
                parameters: {
                    type: 'object', properties: { key: { type: 'string' } }, required: ['key']
                },
                handler: async ({ key }) => browser.perform('pressKey', { key, includeSnapshot: true })
            },
            {
                name: 'browser_list_pages',
                description: 'List the tabs owned by this demo session and show which one is selected.',
                parameters: { type: 'object', properties: {} },
                handler: async () => browser.perform('listPages', {})
            },
            {
                name: 'browser_new_page',
                description: 'Open a trusted product URL in a new demo tab. Use only when a second tab helps preserve the current view.',
                parameters: {
                    type: 'object', properties: { url: { type: 'string' } }, required: ['url']
                },
                handler: async ({ url }) => browser.perform('newPage', { url })
            },
            {
                name: 'browser_select_page',
                description: 'Switch to a tab returned by browser_list_pages.',
                parameters: {
                    type: 'object', properties: { pageId: { type: 'number' } }, required: ['pageId']
                },
                handler: async ({ pageId }) => browser.perform('selectPage', { pageId, bringToFront: true })
            }
        );
    }

    if (multiParticipant) {
        tools.push({
            name: 'next_participant',
            description:
                "Group session only. Call this ONCE you have fully answered whoever currently has the floor AND they have confirmed they have nothing else — it hands the floor to the next visitor who raised their hand and returns their name (or {next:null} if nobody is waiting). NEVER call it while the current person still has questions, or while others are actively discussing the current topic.",
            parameters: { type: 'object', properties: {} },
            handler: async () => nextParticipant?.() ?? { ok: false }
        });
    }

    if (typeof proposeSurvey === 'function' && surveyFieldKeys.length > 0) {
        tools.push({
            name: 'propose_discovery_survey',
            description: `Optional, non-blocking in-call discovery question. Only propose after answering the visitor's current question; the question appears after your spoken answer finishes if policy permits. Never claim it was shown until confirmed. Allowed field keys: ${surveyFieldKeys.join(', ')}. Use only when the answer materially changes the demo or conversation path; do not ask for secrets or contact details.`,
            parameters: {
                type: 'object',
                properties: {
                    questionKey: { type: 'string', enum: surveyFieldKeys },
                    purpose: { type: 'string', enum: ['qualification', 'personalization', 'pricing_context', 'demo_routing'] },
                    question: { type: 'string' },
                    reason: { type: 'string' },
                    answerType: { type: 'string', enum: ['single_select', 'multi_select', 'short_text', 'number'] },
                    options: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { value: { type: 'string' }, label: { type: 'string' } },
                            required: ['value', 'label']
                        }
                    }
                },
                required: ['questionKey', 'purpose', 'question', 'reason', 'answerType']
            },
            handler: async (input) => proposeSurvey(input)
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
