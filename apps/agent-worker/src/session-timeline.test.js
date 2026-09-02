import { describe, it, expect, vi } from 'vitest';
import { createSessionTimeline, withToolCallTimeline, TIMELINE_EVENTS } from './session-timeline.js';

/**
 * *** "ASLA PATLAMAZ" BİR ERİŞİLEBİLİRLİK KURALIDIR, KONFOR DEĞİL ***
 * Bu dosyadaki her `emit` çağrısı canlı bir görüşmenin ortasından gelir.
 * Buradaki bir istisna, izlemeye çalıştığı oturumu düşürür. Aşağıdaki
 * "throw etmez" testleri gevşetilecek bir ayrıntı değil, modülün var olma
 * şartıdır.
 */

function makeLog() {
    return { info: vi.fn(), warn: vi.fn() };
}

describe('createSessionTimeline — sıralama', () => {
    it('seq oturum içinde monoton artar', () => {
        const persist = vi.fn(async () => {});
        const timeline = createSessionTimeline({ sessionId: 's1', log: makeLog(), persist });

        timeline.emit('a');
        timeline.emit('b');
        timeline.emit('c');

        expect(persist.mock.calls.map(([doc]) => doc.seq)).toEqual([1, 2, 3]);
    });

    it('aynı milisaniyede olan olaylar bile seq ile kesin sıralanır', () => {
        // Bu, `at` alanının tek başına neden yetmediğinin doğrudan testi —
        // saat hiç ilerlemese bile sıra korunmalı.
        const persist = vi.fn(async () => {});
        const timeline = createSessionTimeline({
            sessionId: 's1',
            log: makeLog(),
            persist,
            now: () => 1000 // hiç ilerlemeyen saat
        });

        timeline.emit('a');
        timeline.emit('b');

        const docs = persist.mock.calls.map(([doc]) => doc);
        expect(docs.map((d) => d.t)).toEqual([0, 0]); // ayırt edilemez
        expect(docs.map((d) => d.seq)).toEqual([1, 2]); // ama sıra kesin
    });

    it('t, oturum başlangıcından beri geçen süreyi taşır', () => {
        const persist = vi.fn(async () => {});
        let clock = 5_000;
        const timeline = createSessionTimeline({
            sessionId: 's1',
            log: makeLog(),
            persist,
            now: () => clock
        });

        clock = 5_250;
        timeline.emit('a');
        clock = 12_000;
        timeline.emit('b');

        expect(persist.mock.calls.map(([doc]) => doc.t)).toEqual([250, 7_000]);
    });
});

describe('createSessionTimeline — asla patlamaz', () => {
    it('persist reddederse çağıran etkilenmez, sadece uyarı yazılır', async () => {
        const log = makeLog();
        const persist = vi.fn(async () => {
            throw new Error('mongo down');
        });
        const timeline = createSessionTimeline({ sessionId: 's1', log, persist });

        expect(() => timeline.emit('a')).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();
        expect(log.warn).toHaveBeenCalled();
    });

    it('persist senkron throw ederse bile çağıran etkilenmez', () => {
        const log = makeLog();
        const persist = vi.fn(() => {
            throw new Error('boom');
        });
        const timeline = createSessionTimeline({ sessionId: 's1', log, persist });

        expect(() => timeline.emit('a')).not.toThrow();
        expect(log.warn).toHaveBeenCalled();
    });

    it('persist hiç verilmezse olaylar yalnızca log’a gider ve throw etmez', () => {
        const log = makeLog();
        const timeline = createSessionTimeline({ sessionId: 's1', log });

        expect(() => timeline.emit('a', { x: 1 })).not.toThrow();
        expect(log.info).toHaveBeenCalledTimes(1);
    });

    it('persist promise değil düz değer döndürse bile throw etmez', () => {
        // `?.catch?.()` zincirinin gerçek koruması budur: bir sahte/senkron
        // persist implementasyonu sisteme sızarsa sessizce çalışmalı.
        const log = makeLog();
        const timeline = createSessionTimeline({ sessionId: 's1', log, persist: () => 42 });

        expect(() => timeline.emit('a')).not.toThrow();
        expect(log.warn).not.toHaveBeenCalled();
    });
});

describe('createSessionTimeline — span', () => {
    it('begin’i hemen, end’i ölçülen süreyle yazar', () => {
        const persist = vi.fn(async () => {});
        let clock = 0;
        const timeline = createSessionTimeline({
            sessionId: 's1',
            log: makeLog(),
            persist,
            now: () => clock
        });

        const end = timeline.span('x.begin', 'x.end', { url: 'https://salesai.example/' });
        clock = 1_500;
        end({ ok: true });

        const [beginDoc, endDoc] = persist.mock.calls.map(([doc]) => doc);
        expect(beginDoc.type).toBe('x.begin');
        expect(beginDoc.durationMs).toBeUndefined();
        expect(endDoc.type).toBe('x.end');
        expect(endDoc.durationMs).toBe(1_500);
        expect(endDoc.meta).toEqual({ url: 'https://salesai.example/', ok: true });
    });

    it('iki kez kapatmak ikinci bir end olayı üretmez', () => {
        const persist = vi.fn(async () => {});
        const timeline = createSessionTimeline({ sessionId: 's1', log: makeLog(), persist });

        const end = timeline.span('x.begin', 'x.end');
        end();
        end();

        expect(persist.mock.calls.filter(([doc]) => doc.type === 'x.end')).toHaveLength(1);
    });
});

describe('withToolCallTimeline', () => {
    it('tool’un dönüş değerini asla değiştirmez', async () => {
        const timeline = createSessionTimeline({ sessionId: 's1', log: makeLog() });
        const [wrapped] = withToolCallTimeline(
            [{ name: 'search_knowledge', handler: async () => ({ hits: 3 }) }],
            timeline
        );

        expect(await wrapped.handler({ query: 'x' })).toEqual({ hits: 3 });
    });

    it('undefined döndüren bir tool’un undefined’ını korur', async () => {
        // advance_step bilerek undefined döndürüyor (SDK’nın direktifsiz
        // takip turunu bastırmak için) — bu sarmalayıcı onu bozarsa o
        // düzeltme sessizce geri alınmış olur.
        const timeline = createSessionTimeline({ sessionId: 's1', log: makeLog() });
        const [wrapped] = withToolCallTimeline(
            [{ name: 'advance_step', handler: async () => undefined }],
            timeline
        );

        expect(await wrapped.handler({})).toBeUndefined();
    });

    it('tool adını ve modelin verdiği argümanları kaydeder', async () => {
        const persist = vi.fn(async () => {});
        const timeline = createSessionTimeline({ sessionId: 's1', log: makeLog(), persist });
        const [wrapped] = withToolCallTimeline(
            [{ name: 'navigate_to', handler: async () => ({ ok: true }) }],
            timeline
        );

        await wrapped.handler({ url: 'https://salesai.example/pricing' });

        const begin = persist.mock.calls.map(([d]) => d).find((d) => d.type === TIMELINE_EVENTS.TOOL_BEGIN);
        expect(begin.meta).toEqual({
            tool: 'navigate_to',
            args: { url: 'https://salesai.example/pricing' }
        });
    });

    it('tool hata fırlatırsa hatayı yeniden fırlatır ama önce end’i status:error ile yazar', async () => {
        const persist = vi.fn(async () => {});
        const timeline = createSessionTimeline({ sessionId: 's1', log: makeLog(), persist });
        const [wrapped] = withToolCallTimeline(
            [{ name: 'click_element', handler: async () => { throw new Error('locator timeout'); } }],
            timeline
        );

        await expect(wrapped.handler({})).rejects.toThrow('locator timeout');

        const end = persist.mock.calls.map(([d]) => d).find((d) => d.type === TIMELINE_EVENTS.TOOL_END);
        expect(end.meta).toMatchObject({ status: 'error', error: 'locator timeout' });
    });
});
