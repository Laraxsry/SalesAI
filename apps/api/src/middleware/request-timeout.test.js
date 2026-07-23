import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { requestTimeout } from './request-timeout.js';

function fakeRes() {
    const res = new EventEmitter();
    res.headersSent = false;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe('requestTimeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('calls next() immediately without waiting for the deadline', () => {
        const next = vi.fn();
        requestTimeout(5000)({}, fakeRes(), next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('responds 503 once the deadline passes with no finish/close event', () => {
        const res = fakeRes();
        requestTimeout(1000)({}, res, vi.fn());

        vi.advanceTimersByTime(1000);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            error: 'RequestTimeout',
            message: 'Request did not complete within 1000ms'
        });
    });

    it('does not respond if the request finishes before the deadline', () => {
        const res = fakeRes();
        requestTimeout(1000)({}, res, vi.fn());

        res.emit('finish');
        vi.advanceTimersByTime(1000);

        expect(res.status).not.toHaveBeenCalled();
    });

    it('does not respond if the connection closes before the deadline', () => {
        const res = fakeRes();
        requestTimeout(1000)({}, res, vi.fn());

        res.emit('close');
        vi.advanceTimersByTime(1000);

        expect(res.status).not.toHaveBeenCalled();
    });

    it('does not attempt a second response if headers were already sent (e.g. streaming)', () => {
        const res = fakeRes();
        res.headersSent = true;
        requestTimeout(1000)({}, res, vi.fn());

        vi.advanceTimersByTime(1000);

        expect(res.status).not.toHaveBeenCalled();
    });
});
