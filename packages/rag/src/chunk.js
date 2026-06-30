/**
 * Splits text into overlapping chunks on sentence/paragraph boundaries.
 * @param {string} text
 * @param {{ maxChars?: number, overlap?: number }} [opts]
 * @returns {string[]}
 */
export function chunkText(text, { maxChars = 1200, overlap = 200 } = {}) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    if (clean.length <= maxChars) return [clean];

    const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
        if ((current + sentence).length > maxChars && current) {
            chunks.push(current.trim());
            current = current.slice(Math.max(0, current.length - overlap));
        }
        current += sentence;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}
