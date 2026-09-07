import { describe, expect, it, vi } from 'vitest';
import { clickAndSyncTour } from './tour-click.js';

describe('guided-tour click adapter', () => {
    it('returns not-visible failure without publishing a success frame or audit', async () => {
        const result = { ok: false, found: false, reason: 'not_visible' };
        const tour = { click: vi.fn().mockResolvedValue(result) };
        const onSuccess = vi.fn();
        expect(await clickAndSyncTour(tour, 'text=Invented sentence', {}, onSuccess)).toEqual(result);
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('forwards ensureExpanded and returns the expanded panel content to the model', async () => {
        const result = { ok: true, found: true, clicked: false, expanded: true, visibleText: 'FAQ answer' };
        const tour = { click: vi.fn().mockResolvedValue(result) };
        const onSuccess = vi.fn();
        expect(await clickAndSyncTour(tour, '#faq', { ensureExpanded: true }, onSuccess)).toEqual(result);
        expect(tour.click).toHaveBeenCalledWith('#faq', { ensureExpanded: true });
        expect(onSuccess).toHaveBeenCalledWith(result);
    });

    it('does not turn a missing browser result into success', async () => {
        const onSuccess = vi.fn();
        expect(await clickAndSyncTour({ click: vi.fn() }, '#faq', {}, onSuccess))
            .toEqual({ ok: false, reason: 'missing_click_result' });
        expect(onSuccess).not.toHaveBeenCalled();
    });
});
