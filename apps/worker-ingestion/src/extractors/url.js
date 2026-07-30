import { safeFetch } from '@repo/utils';
import * as cheerio from 'cheerio';

/**
 * Fetches a URL and strips it down to readable text. For the seller's live
 * product screens, the agent uses the @repo/screen package (Playwright) to
 * interact with the DOM, but for simple ingestion to vector DB, a plain
 * HTTP fetch + HTML parse is much faster and cheaper.
 */
export async function extractFromUrl(url) {
    const res = await safeFetch(url, { headers: { 'user-agent': 'SalesAI-Ingestor/0.1' } });
    const html = await res.text();
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
