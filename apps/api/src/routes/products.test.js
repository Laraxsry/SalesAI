import { describe, expect, it } from 'vitest';
import { productsRouter } from './products.js';

function registeredRoutes() {
    return productsRouter.stack
        .filter((layer) => layer.route)
        .map((layer) => ({
            path: layer.route.path,
            methods: Object.keys(layer.route.methods).sort()
        }));
}

describe('products router structure', () => {
    it('registers discovery and engagement updates at router composition time', () => {
        expect(registeredRoutes()).toEqual(expect.arrayContaining([
            { path: '/:id/discovery', methods: ['patch'] },
            { path: '/:id/engagement', methods: ['patch'] }
        ]));
    });
});
