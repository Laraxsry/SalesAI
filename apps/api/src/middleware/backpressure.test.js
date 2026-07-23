import { describe, it, expect, vi } from 'vitest';
import { isOverloaded, backpressureMiddleware } from './backpressure.js';

describe('isOverloaded', () => {
    it('is not overloaded when lag is below the threshold', () => {
        expect(isOverloaded(50, 200)).toBe(false);
    });

    it('is not overloaded exactly at the threshold (strictly greater-than)', () => {
        expect(isOverloaded(200, 200)).toBe(false);
    });

    it('is overloaded once lag exceeds the threshold', () => {
        expect(isOverloaded(201, 200)).toBe(true);
    });
});

describe('backpressureMiddleware', () => {
    function mockRes() {
        const res = { set: vi.fn(), status: vi.fn(), json: vi.fn() };
        res.status.mockReturnValue(res);
        return res;
    }

    it('calls next() when lag is under the threshold', () => {
        const next = vi.fn();
        const res = mockRes();
        const middleware = backpressureMiddleware({ thresholdMs: 200, getLagMs: () => 10 });

        middleware({ path: '/api/v1/agents' }, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('responds 503 with Retry-After when lag exceeds the threshold', () => {
        const next = vi.fn();
        const res = mockRes();
        const middleware = backpressureMiddleware({ thresholdMs: 200, getLagMs: () => 500 });

        middleware({ path: '/api/v1/agents' }, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.set).toHaveBeenCalledWith('Retry-After', '1');
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            error: 'ServerOverloaded',
            message: 'Server is under heavy load, please retry shortly'
        });
    });

    it.each(['/health', '/ready', '/metrics'])('never sheds exempt path %s, even while overloaded', (path) => {
        const next = vi.fn();
        const res = mockRes();
        const middleware = backpressureMiddleware({ thresholdMs: 200, getLagMs: () => 999 });

        middleware({ path }, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('respects a custom exemptPaths list instead of the default', () => {
        const next = vi.fn();
        const res = mockRes();
        const middleware = backpressureMiddleware({ thresholdMs: 200, exemptPaths: ['/custom'], getLagMs: () => 999 });

        middleware({ path: '/health' }, res, next); // no longer exempt with a custom list

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
    });
});
