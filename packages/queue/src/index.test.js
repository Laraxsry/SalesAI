import { describe, it, expect } from 'vitest';
import { isFinalFailure } from './index.js';

describe('isFinalFailure', () => {
    it('is false when attempts remain', () => {
        expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
    });

    it('is true once attemptsMade reaches the configured attempts', () => {
        expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } })).toBe(true);
    });

    it('is true once attemptsMade exceeds the configured attempts', () => {
        expect(isFinalFailure({ attemptsMade: 4, opts: { attempts: 3 } })).toBe(true);
    });

    it('defaults to a single attempt when opts.attempts is missing', () => {
        expect(isFinalFailure({ attemptsMade: 1, opts: {} })).toBe(true);
    });

    it('defaults attemptsMade to 0 when missing', () => {
        expect(isFinalFailure({ opts: { attempts: 3 } })).toBe(false);
    });

    it('is false for a fresh job with no opts at all', () => {
        expect(isFinalFailure({})).toBe(false);
    });
});
