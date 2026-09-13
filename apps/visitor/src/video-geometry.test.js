import { describe, expect, it } from 'vitest';
import { containedVideoBox } from './video-geometry.js';

describe('containedVideoBox', () => {
    it('accounts for side letterboxing on a wide stage', () => {
        expect(containedVideoBox(2000, 900)).toEqual({ left: 200, top: 0, width: 1600, height: 900 });
    });

    it('accounts for top letterboxing on a tall stage', () => {
        expect(containedVideoBox(1280, 1000)).toEqual({ left: 0, top: 140, width: 1280, height: 720 });
    });
});
