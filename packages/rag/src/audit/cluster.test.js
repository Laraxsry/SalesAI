import { describe, it, expect } from 'vitest';
import { clusterChunks, CANDIDATE_THRESHOLD } from './cluster.js';

/** A unit vector at `angle` radians in the first two dimensions. */
function vectorAt(angle, dimensions = 8) {
    const v = new Array(dimensions).fill(0);
    v[0] = Math.cos(angle);
    v[1] = Math.sin(angle);
    return v;
}

/** A vector whose cosine similarity to vectorAt(0) is exactly `target`. */
function vectorSimilarTo(target, dimensions = 8) {
    return vectorAt(Math.acos(target), dimensions);
}

function chunk(id, sourceId, embedding, text = id) {
    return { id, sourceId, text, embedding };
}

describe('clusterChunks', () => {
    it('groups chunks that make a claim about the same thing', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's2', vectorSimilarTo(0.99))
        ]);

        expect(clusters).toHaveLength(1);
        expect(clusters[0].chunkIds).toEqual(['a', 'b']);
    });

    // Measured on real embeddings: two prices for the same package score 0.947,
    // *above* a plain reworded duplicate's neighbourhood. Reading the verdict off
    // the score would file the single most important finding as a duplicate and
    // quietly delete one of the two conflicting prices.
    it('treats a same-fact conflict as a candidate rather than classifying it', () => {
        const { clusters } = clusterChunks([
            chunk('price-500', 's1', vectorAt(0)),
            chunk('price-750', 's2', vectorSimilarTo(0.947))
        ]);

        expect(clusters).toHaveLength(1);
        expect(clusters[0]).not.toHaveProperty('type');
        expect(clusters[0].chunkIds).toEqual(['price-500', 'price-750']);
    });

    it('keeps same-source pairs — one document can repeat or contradict itself', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's1', vectorSimilarTo(0.918))
        ]);

        expect(clusters).toHaveLength(1);
    });

    // Two different pricing tiers measured 0.624 — related subject matter, no
    // conflict. Reviewing pairs like these is pure LLM spend.
    it('leaves merely-related content out of the candidate pool', () => {
        const { clusters } = clusterChunks([
            chunk('starter', 's1', vectorAt(0)),
            chunk('enterprise', 's2', vectorSimilarTo(0.624))
        ]);

        expect(clusters).toEqual([]);
    });

    it('ignores unrelated chunks entirely', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's2', vectorSimilarTo(0.3))
        ]);

        expect(clusters).toEqual([]);
    });

    it('merges a transitive chain into one cluster instead of overlapping pairs', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's2', vectorSimilarTo(0.98)),
            chunk('c', 's3', vectorSimilarTo(0.96))
        ]);

        expect(clusters).toHaveLength(1);
        expect(clusters[0].chunkIds).toEqual(['a', 'b', 'c']);
    });

    it('caps a cluster at maxClusterSize so one prompt cannot grow unbounded', () => {
        const chunks = Array.from({ length: 10 }, (_, i) =>
            chunk(`c${i}`, `s${i}`, vectorSimilarTo(0.99 - i * 0.001))
        );

        const { clusters } = clusterChunks(chunks, { maxClusterSize: 4 });

        expect(clusters[0].chunkIds.length).toBe(4);
    });

    it('caps the number of clusters and reports the truncation', () => {
        // Each pair lives in its own two dimensions, so pairs are mutually
        // orthogonal and cannot bleed into one another's cluster.
        const chunks = [];
        for (let pair = 0; pair < 5; pair++) {
            const inPlane = (angle) => {
                const v = new Array(10).fill(0);
                v[pair * 2] = Math.cos(angle);
                v[pair * 2 + 1] = Math.sin(angle);
                return v;
            };
            chunks.push(chunk(`a${pair}`, `s${pair}a`, inPlane(0)));
            chunks.push(chunk(`b${pair}`, `s${pair}b`, inPlane(Math.acos(0.99))));
        }

        const all = clusterChunks(chunks);
        expect(all.clusters.length).toBe(5);
        expect(all.truncated).toBe(false);

        const capped = clusterChunks(chunks, { maxClusters: 2 });
        expect(capped.clusters.length).toBe(2);
        expect(capped.truncated).toBe(true);
    });

    it('reports the strongest similarity of the cluster, not the weakest pair', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's2', vectorSimilarTo(0.999)),
            chunk('c', 's3', vectorSimilarTo(0.93))
        ]);

        expect(clusters[0].similarity).toBeGreaterThan(0.99);
    });

    it('orders clusters by similarity so the clearest findings come first', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's2', vectorSimilarTo(0.9)),
            chunk('x', 's3', vectorAt(Math.PI / 2)),
            chunk('y', 's4', vectorAt(Math.PI / 2 - Math.acos(0.99)))
        ]);

        expect(clusters[0].similarity).toBeGreaterThan(clusters[1].similarity);
    });

    it('skips chunks with no embedding rather than throwing', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0)),
            chunk('b', 's2', undefined),
            chunk('c', 's3', [])
        ]);

        expect(clusters).toEqual([]);
    });

    it('ignores chunks embedded with a different model instead of comparing mismatched dimensions', () => {
        const { clusters } = clusterChunks([
            chunk('a', 's1', vectorAt(0, 8)),
            chunk('b', 's2', vectorSimilarTo(0.99, 4))
        ]);

        expect(clusters).toEqual([]);
    });

    it('returns nothing for fewer than two usable chunks', () => {
        expect(clusterChunks([]).clusters).toEqual([]);
        expect(clusterChunks([chunk('a', 's1', vectorAt(0))]).clusters).toEqual([]);
    });

    it('compares every pair exactly once', () => {
        const chunks = Array.from({ length: 5 }, (_, i) => chunk(`c${i}`, 's1', vectorAt(i)));
        expect(clusterChunks(chunks).comparisons).toBe(10); // 5*4/2
    });

    it('sits below the measured contradiction and near-duplicate scores', () => {
        expect(CANDIDATE_THRESHOLD).toBeLessThan(0.918);
        expect(CANDIDATE_THRESHOLD).toBeGreaterThan(0.624);
    });
});

describe('clusterChunks — chunker overlap', () => {
    // chunkText cuts with a 200-character overlap, so consecutive chunks of one
    // source share text by construction. Reviewing them would spend a call to be
    // told that half a paragraph duplicates the other half.
    it('skips consecutive chunks of the same source', () => {
        const { clusters, comparisons } = clusterChunks([
            { id: 'a', sourceId: 's1', ordinal: 0, text: 'a', embedding: vectorAt(0) },
            { id: 'b', sourceId: 's1', ordinal: 1, text: 'b', embedding: vectorSimilarTo(0.99) }
        ]);

        expect(clusters).toEqual([]);
        expect(comparisons).toBe(0);
    });

    it('still compares non-adjacent chunks of the same source', () => {
        const { clusters } = clusterChunks([
            { id: 'a', sourceId: 's1', ordinal: 0, text: 'a', embedding: vectorAt(0) },
            { id: 'b', sourceId: 's1', ordinal: 5, text: 'b', embedding: vectorSimilarTo(0.99) }
        ]);

        expect(clusters).toHaveLength(1);
    });

    it('still compares adjacent ordinals belonging to different sources', () => {
        const { clusters } = clusterChunks([
            { id: 'a', sourceId: 's1', ordinal: 0, text: 'a', embedding: vectorAt(0) },
            { id: 'b', sourceId: 's2', ordinal: 1, text: 'b', embedding: vectorSimilarTo(0.99) }
        ]);

        expect(clusters).toHaveLength(1);
    });

    it('compares everything when no ordinal is supplied', () => {
        const { clusters } = clusterChunks([
            { id: 'a', sourceId: 's1', text: 'a', embedding: vectorAt(0) },
            { id: 'b', sourceId: 's1', text: 'b', embedding: vectorSimilarTo(0.99) }
        ]);

        expect(clusters).toHaveLength(1);
    });
});
