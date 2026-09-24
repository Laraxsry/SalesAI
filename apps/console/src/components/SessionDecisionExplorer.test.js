import { describe, expect, it } from 'vitest';
import { routeDiff } from '../lib/sessionDecisionTraceView.js';

describe('routeDiff', () => {
    it('separates added, retained and removed nodes', () => {
        const revisions = [
            { revision: 0, nodes: [{ id: 'intro' }, { id: 'close' }] },
            { revision: 1, baseRevision: 0, nodes: [{ id: 'answer' }, { id: 'close' }] }
        ];
        expect(routeDiff(revisions[1], revisions)).toEqual({
            added: ['answer'], retained: ['close'], removed: ['intro']
        });
    });
});
