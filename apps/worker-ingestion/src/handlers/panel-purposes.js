/**
 * Adds a plain-language `purpose` ("what is this button for") to the buttons of a crawled dashboard.
 *
 * Only buttons whose press was actually observed (they carry `expected`, see extractors/ui-guide.js) are
 * described, so the model is only ever asked about something that was seen, and the cost is bounded: one
 * call per page, a handful of buttons each, at most `maxPages` pages per crawl. A button that already has a
 * purpose from an earlier crawl is left as it is, so re-crawling an unchanged panel costs nothing.
 *
 * @param {{
 *   pagesIndex:Record<string, { components?: { interactiveElements?: object[] } }>,
 *   describe:(input:{ pageUrl:string, items:{label:string, observed:string}[], language:string })=>Promise<Record<string,string>>,
 *   language?:string, maxPages?:number, maxItems?:number
 * }} input
 * @returns {Promise<{ pages:number, described:number }>}
 */
export async function addElementPurposes({ pagesIndex, describe, language = 'English', maxPages = 25, maxItems = 12 }) {
    let pages = 0;
    let described = 0;
    for (const [pageUrl, page] of Object.entries(pagesIndex || {})) {
        if (pages >= maxPages) break;
        const elements = page.components?.interactiveElements || [];
        const pending = elements.filter((element) => element.expected && !element.purpose).slice(0, maxItems);
        if (!pending.length) continue;

        pages++;
        const purposes = await describe({
            pageUrl,
            items: pending.map((element) => ({ label: element.label, observed: element.expected })),
            language
        }).catch(() => ({}));
        for (const element of pending) {
            if (purposes?.[element.label]) {
                element.purpose = purposes[element.label];
                described++;
            }
        }
    }
    return { pages, described };
}
