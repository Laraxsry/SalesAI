/** Cosine similarity of two equal-length vectors; 0 when either has no magnitude. */
export function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}
