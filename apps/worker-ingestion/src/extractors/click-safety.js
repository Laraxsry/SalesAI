/**
 * Click-safety policy for the crawler: which UI labels it may click while
 * exploring an arbitrary customer's site. One place, so the nav, tab and
 * toggle discovery passes cannot drift apart on what counts as "has a real
 * side effect".
 */

// A candidate's visible text has to be this short to be considered a menu
// item (vs. a paragraph-length CTA button).
export const MAX_LABEL_CHARS = 40;

// Actions with a real side effect on a marketing/customer site (lead-gen
// forms, auth, calls, downloads, sharing). Shared by nav, tab and toggle
// discovery — widening it changes all three, so extend `PANEL_ACTION_WORDS`
// below for anything specific to logged-in panels instead.
export const ACTION_WORDS =
    /demo|talep|teklif|sipariş|satın|buy|purchase|order|sign\s*up|sign\s*in|kayıt\s*ol|giriş\s*yap|log\s*in|log\s*out|çıkış|gönder|submit|kaydet|\bsave\b|\bsil\b|delete|abone|subscribe|indir|download|iletişime\s*geç|contact\s*us|whatsapp|\bara\b|\bcall\b|paylaş|share/i;

// Extra actions that are dangerous inside a logged-in panel (publishing,
// running, deleting, billing). Only applied where the crawler clicks
// panel chrome (see nav-discovery.js), so ordinary FAQ/tab labels such as
// "How do I run a report?" are not affected.
export const PANEL_ACTION_WORDS =
    /publish|yayınla|deploy|\brun\b|çalıştır|upgrade|yükselt|remove|kaldır|reset|sıfırla|\binvite\b|davet|archive|arşivle|duplicate|çoğalt|\btrain\b|eğit|import|export|\bsync\b|disconnect|revoke|uninstall|cancel\s*(?:subscription|plan)|\bplay\b/i;

// Buttons that make something new. A crawl that presses them fills the account with junk (and
// then follows the new item's page). Creation is learned on purpose, with a recognisable name
// and a cleanup, by the learning step — not by a crawl pressing buttons to see what happens.
export const CREATE_WORDS = /(?<![\p{L}\p{N}])(?:create|new|add|upload|attach|yeni|oluştur|olustur|ekle)(?![\p{L}\p{N}])/iu;

/**
 * A button whose text reads like a sentence or a question is a suggested prompt for an AI
 * assistant ("Which tools fail most often?", "Write a test for my most common request").
 * Pressing it sends that prompt — a real, billed AI call on the account.
 */
export function looksLikePrompt(label) {
    return label.trim().endsWith('?') || label.trim().split(/\s+/).length >= 5;
}

/**
 * The same kind of button with a different number or date in it ("Sep 22", "Sep 23", "Page 2", "Page 3")
 * opens the same kind of thing. Pressing one of each shape is enough.
 */
export function labelShape(label) {
    return label
        .toLowerCase()
        .replace(/(?<![\p{L}])(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\p{L}]*/gu, 'month')
        .replace(/(?<![\p{L}])(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)/gu, 'month')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Whether the crawler may press `label` just to see what it opens: a safe panel label that does
 * not create something and is not a suggested prompt. `allowCreate` lets a run that cleans up
 * after itself press creation buttons too.
 */
export function isSafeToPeek(label, { allowCreate = false, ...options } = {}) {
    if (!isSafeNavClick(label, options)) return false;
    if (looksLikePrompt(label)) return false;
    return allowCreate || !CREATE_WORDS.test(label);
}

/** Whether `label` is short enough to be a menu item and free of side-effect words. */
export function isSafeToClick(label, { maxChars = MAX_LABEL_CHARS, extraDenied = null } = {}) {
    if (!label || label.length > maxChars) return false;
    if (ACTION_WORDS.test(label)) return false;
    return !(extraDenied && extraDenied.test(label));
}

/** Same as `isSafeToClick`, with the stricter logged-in-panel word list. */
export function isSafeNavClick(label, options = {}) {
    return isSafeToClick(label, { ...options, extraDenied: PANEL_ACTION_WORDS });
}
