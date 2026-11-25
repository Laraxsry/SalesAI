import { describe, expect, it } from 'vitest';
import { arrowGeometry, circlePath, nextAnnotation } from './annotation-geometry.js';

const box = { left: 0, top: 0, width: 1280, height: 720 };

function pathPoints(d) {
    return [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
}

describe('nextAnnotation', () => {
    const circle = { action: 'focus', style: 'circle', cueId: 'c1', target: { x: 0.1, y: 0.1, width: 0.1, height: 0.05 } };

    it('keeps a circle while the cursor moves and clicks inside it', () => {
        const kept = [{ action: 'cursor_move' }, { action: 'click' }, { action: 'scroll' }]
            .reduce(nextAnnotation, nextAnnotation(null, circle));
        expect(kept).toBe(circle);
    });

    it('drops the mark on clear or on any other focus style', () => {
        expect(nextAnnotation(circle, null)).toBeNull();
        expect(nextAnnotation(circle, { action: 'focus', style: 'outline', target: circle.target })).toBeNull();
    });

    it('ignores marks without geometry', () => {
        expect(nextAnnotation(null, { action: 'focus', style: 'arrow' })).toBeNull();
    });
});

describe('circlePath', () => {
    it('encloses every corner of the target', () => {
        const rect = { left: 500, top: 300, width: 140, height: 40 };
        const points = pathPoints(circlePath(rect));
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const rx = Math.max(...points.map((point) => Math.abs(point.x - cx)));
        const ry = Math.max(...points.map((point) => Math.abs(point.y - cy)));

        expect(((rect.width / 2) / rx) ** 2 + ((rect.height / 2) / ry) ** 2).toBeLessThan(1);
    });
});

describe('arrowGeometry', () => {
    it('comes in from the side with the most room and stops outside the target', () => {
        const rect = { left: 600, top: 40, width: 80, height: 30 };
        const arrow = arrowGeometry(rect, box);

        expect(arrow.side).toBe('bottom');
        expect(arrow.head.y).toBeGreaterThan(rect.top + rect.height);
        expect(arrow.nudge).toEqual({ x: 0, y: -5 });
    });

    it('keeps the whole arrow inside the video frame', () => {
        const rect = { left: 40, top: 340, width: 50, height: 30 };
        const arrow = arrowGeometry(rect, box);
        const points = [...pathPoints(arrow.shaft), ...pathPoints(arrow.tip)];

        expect(arrow.side).toBe('right');
        for (const point of points) {
            expect(point.x).toBeGreaterThanOrEqual(box.left);
            expect(point.x).toBeLessThanOrEqual(box.left + box.width);
            expect(point.y).toBeGreaterThanOrEqual(box.top);
            expect(point.y).toBeLessThanOrEqual(box.top + box.height);
        }
    });
});
