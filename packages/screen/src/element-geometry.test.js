import { describe, expect, it } from 'vitest';
import { normalizeElementGeometry, parseEvaluationJson } from './element-geometry.js';

describe('element geometry', () => {
    it('normalizes coordinates for object-contain presentation', () => {
        expect(normalizeElementGeometry({
            visible: true,
            viewport: { width: 1000, height: 500 },
            rect: { x: 250, y: 100, width: 200, height: 50 },
            clientRects: [{ x: 250, y: 100, width: 100, height: 20 }]
        })).toEqual({
            x: 0.25, y: 0.2, width: 0.2, height: 0.1,
            rects: [{ x: 0.25, y: 0.2, width: 0.1, height: 0.04 }]
        });
    });

    it('reads JSON embedded in MCP result text', () => {
        expect(parseEvaluationJson('Script result: {"visible":true}'))
            .toEqual({ visible: true });
    });
});
