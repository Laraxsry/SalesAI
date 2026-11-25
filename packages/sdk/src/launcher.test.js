import { describe, it, expect } from 'vitest';
import { STOCK_LAUNCHER_LABEL, WAVE_CYCLE_MS, launcherCopy, resolveLauncherLabel, resolveLocale, waveStepMs } from './launcher.js';

describe('resolveLocale', () => {
    it('prefers the host page language over the browser language', () => {
        expect(resolveLocale({ documentLang: 'tr', navigatorLanguage: 'en-US' })).toBe('tr');
        expect(resolveLocale({ documentLang: 'en', navigatorLanguage: 'tr-TR' })).toBe('en');
    });

    it('falls back to the browser language when the page declares none', () => {
        expect(resolveLocale({ documentLang: '', navigatorLanguage: 'tr-TR' })).toBe('tr');
    });

    it('defaults to English for unsupported or missing languages', () => {
        expect(resolveLocale({ documentLang: 'de-DE' })).toBe('en');
        expect(resolveLocale()).toBe('en');
    });
});

describe('resolveLauncherLabel', () => {
    it('uses the host-page override above everything else', () => {
        expect(resolveLauncherLabel({ override: 'AI temsilciyle konuş', configLabel: 'Book a demo', locale: 'en' })).toBe(
            'AI temsilciyle konuş'
        );
    });

    it('keeps a label the seller customized in the dashboard', () => {
        expect(resolveLauncherLabel({ configLabel: 'Book a demo', locale: 'tr' })).toBe('Book a demo');
    });

    it('localizes the stock schema default instead of treating it as a customization', () => {
        expect(resolveLauncherLabel({ configLabel: STOCK_LAUNCHER_LABEL, locale: 'tr' })).toBe(launcherCopy('tr').label);
        expect(resolveLauncherLabel({ configLabel: STOCK_LAUNCHER_LABEL, locale: 'en' })).toBe(STOCK_LAUNCHER_LABEL);
    });

    it('uses the localized default before the config has loaded', () => {
        expect(resolveLauncherLabel({ locale: 'tr' })).toBe(launcherCopy('tr').label);
    });
});

describe('launcherCopy', () => {
    it('falls back to English for an unknown locale', () => {
        expect(launcherCopy('fr')).toEqual(launcherCopy('en'));
    });
});

describe('waveStepMs', () => {
    it('fits the whole sweep inside one wave cycle for a typical label', () => {
        const chars = Array.from('AI temsilciyle konuş').length;
        expect(waveStepMs(chars) * (chars - 1)).toBeLessThan(WAVE_CYCLE_MS);
    });

    it('speeds the stagger up for long labels instead of letting the sweep crawl', () => {
        expect(waveStepMs(40)).toBeLessThan(waveStepMs(12));
    });

    it('stays within a natural range for very short and very long labels', () => {
        expect(waveStepMs(1)).toBe(60);
        expect(waveStepMs(200)).toBe(18);
    });
});
