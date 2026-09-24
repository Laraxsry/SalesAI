import { describe, expect, it } from 'vitest';
import { projectDynamicRouteForPresentation } from './dynamic-route-presentation.js';

describe('dynamic route presentation projection', () => {
    it('keeps accepted node order and marks required closing as important', () => {
        const result = projectDynamicRouteForPresentation([
            { id: 'answer', type: 'answer', objective: 'Yanıtla', evidenceRefs: ['e1'] },
            { id: 'demo', type: 'demo', objective: 'Ekranı göster', evidenceRefs: ['e1'],
                pageIntent: { purpose: 'demo', preferredUrl: 'https://example.test/demo' } },
            { id: 'close', type: 'obligation', objective: 'Kapanış yap',
                requirement: 'required_before_close' }
        ]);
        expect(result.map((node) => node.id)).toEqual(['answer', 'demo', 'close']);
        expect(result[1]).toMatchObject({
            url: 'https://example.test/demo', actions: [],
            dynamicNode: { type: 'demo' }
        });
        expect(result[2].mode).toBe('important');
    });

    it('rejects duplicate or malformed routes', () => {
        expect(() => projectDynamicRouteForPresentation([])).toThrow();
        expect(() => projectDynamicRouteForPresentation([
            { id: 'a', type: 'check', objective: 'one' },
            { id: 'a', type: 'check', objective: 'two' }
        ])).toThrow(/duplicate/);
    });
});
