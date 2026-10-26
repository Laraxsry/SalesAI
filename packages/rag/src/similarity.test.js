import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './similarity.js';

describe('cosineSimilarity', () => {
    it('is 1 for the same direction, 0 for orthogonal, -1 for opposite', () => {
        expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    it('does not divide by zero for an empty or all-zero vector', () => {
        expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
        expect(cosineSimilarity([], [])).toBe(0);
    });
});
