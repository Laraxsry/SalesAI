import { describe, it, expect } from 'vitest';
import { createUtteranceMemory } from './utterance-memory.js';

describe('createUtteranceMemory', () => {
    it('returns the most recent utterance with its interrupted flag', () => {
        const memory = createUtteranceMemory();
        memory.record('İlk cümle.');
        memory.record('Kesilen cümle', { interrupted: true });

        expect(memory.last()).toEqual({ text: 'Kesilen cümle', interrupted: true });
    });

    it('has nothing to offer before anything was said', () => {
        expect(createUtteranceMemory().last()).toBeNull();
    });

    it('defaults interrupted to false', () => {
        const memory = createUtteranceMemory();
        memory.record('Tamamlanan cümle.');
        expect(memory.last().interrupted).toBe(false);
    });

    it('drops the oldest once it is full', () => {
        const memory = createUtteranceMemory({ keep: 2 });
        memory.record('a');
        memory.record('b');
        memory.record('c');

        expect(memory.recent().map((e) => e.text)).toEqual(['b', 'c']);
    });

    // A text-modality-only conversation item arrives with no text; recording it
    // would leave `last()` handing the model an empty referent to not repeat.
    it('ignores empty and whitespace-only text', () => {
        const memory = createUtteranceMemory();
        memory.record('gerçek cümle');
        memory.record('');
        memory.record('   \n  ');
        memory.record(undefined);

        expect(memory.last().text).toBe('gerçek cümle');
        expect(memory.recent()).toHaveLength(1);
    });

    it('trims surrounding whitespace', () => {
        const memory = createUtteranceMemory();
        memory.record('  boşluklu  ');
        expect(memory.last().text).toBe('boşluklu');
    });

    // Where the narration STOPPED is what a resumed step needs to know; the
    // opening words are the part the model would reproduce on its own anyway.
    it('keeps the tail of an over-long utterance, not the head', () => {
        const memory = createUtteranceMemory({ maxChars: 10 });
        memory.record('BAŞLANGIÇ ortadaki kısım SONDAKI');

        const { text } = memory.last();
        expect(text).toBe('…ım SONDAKI');
        expect(text).not.toContain('BAŞLANGIÇ');
    });

    it('returns short text verbatim, with no elision marker', () => {
        const memory = createUtteranceMemory({ maxChars: 100 });
        memory.record('kısa');
        expect(memory.last().text).toBe('kısa');
    });

    it('clear() empties the memory', () => {
        const memory = createUtteranceMemory();
        memory.record('bir şey');
        memory.clear();
        expect(memory.last()).toBeNull();
    });
});
