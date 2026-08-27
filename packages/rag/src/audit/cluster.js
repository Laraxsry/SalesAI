/**
 * Finds the chunk groups worth spending an LLM call on.
 *
 * A contradiction is never visible in a single chunk — "the price is 500" and
 * "the price is 750" are each perfectly coherent on their own, and only
 * conflict when read together. So the reviewer has to be shown groups, not
 * chunks. Asking an LLM about every possible pair is O(n²) *calls*, which is
 * hopeless; instead the embeddings that already exist do the narrowing for
 * free, and the LLM only ever judges a handful of small clusters.
 *
 * Crucially, similarity decides *candidacy only* — never the verdict.
 * Measured against text-embedding-3-large on real Turkish product copy:
 *
 *   0.984  the same sentence, reworded
 *   0.947  the same sentence with a *different price* — a real contradiction
 *   0.918  two phrasings of one feature, same document
 *   0.624  two different pricing tiers — related, not in conflict
 *   0.300  unrelated
 *
 * A contradiction scores *higher* than a mere near-duplicate, because
 * embeddings do not encode the one number that makes the two statements
 * incompatible. Any attempt to read "duplicate vs contradiction" off the
 * score is therefore backwards; that call belongs to the reviewer LLM, which
 * is the only stage that can actually compare the claims.
 *
 * Pure functions, no I/O — the threshold is the whole behaviour of this
 * stage, so it is testable without a database or a model.
 */

/**
 * At or above this cosine similarity two chunks are making a claim about the
 * same thing, and are worth reading side by side. Set below the observed
 * contradiction score (0.947) and near-duplicate score (0.918) with margin,
 * and well above unrelated-but-adjacent content (0.624), so the reviewer sees
 * every genuine conflict without being flooded with merely-related pairs.
 */
export const CANDIDATE_THRESHOLD = 0.88;

/**
 * A cluster is a prompt; an unbounded one would blow the context window and
 * produce a verdict too vague to act on. Oversized groups are truncated to
 * their strongest members rather than dropped.
 */
export const MAX_CLUSTER_SIZE = 8;

/**
 * True for two consecutive chunks of the same source — they share `overlap`
 * characters because `chunkText` put them there, so their similarity says
 * nothing about the knowledge itself.
 */
function isChunkerOverlap(a, b) {
    return (
        a.sourceId === b.sourceId &&
        Number.isInteger(a.ordinal) &&
        Number.isInteger(b.ordinal) &&
        Math.abs(a.ordinal - b.ordinal) === 1
    );
}

/** Returns a copy of `vector` scaled to unit length, as a Float32Array. */
function normalize(vector) {
    const out = new Float32Array(vector.length);
    let sumSquares = 0;
    for (let i = 0; i < vector.length; i++) sumSquares += vector[i] * vector[i];
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return out;
    for (let i = 0; i < vector.length; i++) out[i] = vector[i] / magnitude;
    return out;
}

/**
 * Union-Find over chunk indices — turns the list of similar pairs into
 * connected groups, so A~B and B~C land in one cluster of three rather than
 * two overlapping pairs the reviewer would judge (and bill for) twice.
 */
function createUnionFind(size) {
    const parent = Array.from({ length: size }, (_, i) => i);
    const find = (i) => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    return {
        find,
        union(a, b) {
            const rootA = find(a);
            const rootB = find(b);
            if (rootA !== rootB) parent[rootB] = rootA;
        }
    };
}

/**
 * Groups chunks that make claims about the same thing into review candidates.
 *
 * Same-source pairs are deliberately kept: a document really can repeat a
 * paragraph, or state a figure in a summary that its own detail section
 * contradicts after an in-place edit. Which source each chunk came from is
 * evidence for the reviewer, not a reason to skip the pair.
 *
 * *Adjacent* chunks of one source are the exception. `chunkText` cuts with a
 * 200-character overlap, so consecutive chunks literally share text and score
 * as similar by construction — an artefact of our own chunker, never a real
 * redundancy. Reviewing them wastes calls and invites a verdict that would
 * retire half of a paragraph. Callers pass `ordinal` (position within the
 * source) to enable this; without it every pair is compared as before.
 *
 * @param {Array<{id:string, sourceId:string, text:string, embedding:number[], ordinal?:number}>} chunks
 * @param {{threshold?:number, maxClusterSize?:number, maxClusters?:number}} [opts]
 * @returns {{clusters: Array<{chunkIds:string[], similarity:number}>, comparisons:number, truncated:boolean}}
 */
export function clusterChunks(chunks, opts = {}) {
    const {
        threshold = CANDIDATE_THRESHOLD,
        maxClusterSize = MAX_CLUSTER_SIZE,
        maxClusters = Infinity
    } = opts;

    const usable = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
    if (usable.length < 2) return { clusters: [], comparisons: 0, truncated: false };

    const vectors = usable.map((c) => normalize(c.embedding));
    const dimensions = vectors[0].length;

    const edges = [];
    let comparisons = 0;

    for (let i = 0; i < usable.length; i++) {
        const a = vectors[i];
        if (a.length !== dimensions) continue; // mixed embedding models — not comparable
        for (let j = i + 1; j < usable.length; j++) {
            const b = vectors[j];
            if (b.length !== dimensions) continue;
            if (isChunkerOverlap(usable[i], usable[j])) continue;
            comparisons++;

            let similarity = 0;
            for (let d = 0; d < dimensions; d++) similarity += a[d] * b[d];
            if (similarity >= threshold) edges.push({ i, j, similarity });
        }
    }

    const grouped = groupEdges(edges, usable, maxClusterSize);
    return {
        clusters: grouped.slice(0, maxClusters),
        comparisons,
        truncated: grouped.length > maxClusters
    };
}

/** Connected components over `edges`, emitted strongest-similarity first. */
function groupEdges(edges, chunks, maxClusterSize) {
    if (!edges.length) return [];

    const unionFind = createUnionFind(chunks.length);
    for (const edge of edges) unionFind.union(edge.i, edge.j);

    /** @type {Map<number, {members:Set<number>, similarity:number}>} */
    const groups = new Map();
    for (const edge of edges) {
        const root = unionFind.find(edge.i);
        const group = groups.get(root) || { members: new Set(), similarity: 0 };
        group.members.add(edge.i);
        group.members.add(edge.j);
        group.similarity = Math.max(group.similarity, edge.similarity);
        groups.set(root, group);
    }

    return Array.from(groups.values())
        .map((group) => ({
            // Deterministic order so a re-run produces the same finding keys.
            chunkIds: Array.from(group.members)
                .sort((a, b) => a - b)
                .slice(0, maxClusterSize)
                .map((index) => chunks[index].id),
            similarity: group.similarity
        }))
        .sort((a, b) => b.similarity - a.similarity);
}
