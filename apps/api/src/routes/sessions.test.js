import { describe, expect, it } from 'vitest';
import { sessionsRouter } from './sessions.js';

describe('sessions router structure', () => {
    it('registers the authenticated decision trace before the generic session route', () => {
        const routes = sessionsRouter.stack
            .filter((layer) => layer.route)
            .map((layer) => ({
                path: layer.route.path,
                methods: Object.keys(layer.route.methods).sort(),
                middlewareCount: layer.route.stack.length
            }));
        const decisionIndex = routes.findIndex((route) =>
            route.path === '/:id/decision-trace' && route.methods.includes('get'));
        const genericIndex = routes.findIndex((route) =>
            route.path === '/:id' && route.methods.includes('get'));

        expect(decisionIndex).toBeGreaterThanOrEqual(0);
        expect(decisionIndex).toBeLessThan(genericIndex);
        expect(routes[decisionIndex].middlewareCount).toBeGreaterThanOrEqual(2);
    });
});
