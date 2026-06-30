/**
 * Fetches a URL and strips it down to readable text. For the seller's live
 * software dashboard this is the entry point for a deeper crawl (follow links,
 * render with Playwright for SPAs). Kept minimal here.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function extractFromUrl(url) {
    if (!url) return '';
    const res = await fetch(url, { headers: { 'user-agent': 'SalesAI-Ingestor/0.1' } });
    const html = await res.text();
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
