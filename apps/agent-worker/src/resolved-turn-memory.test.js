import { describe, expect, it } from 'vitest';
import { createResolvedTurnMemory } from './resolved-turn-memory.js';

describe('resolved turn memory', () => {
    it('records a completed question and answer for immediate continuity', () => {
        const memory = createResolvedTurnMemory();
        expect(memory.record({
            question: 'Talepleri şu anda nasıl yönetiyorsunuz?',
            answer: 'E-posta ile yönetiyoruz.'
        })).toBe(true);
        expect(memory.instruction()).toContain('E-posta ile yönetiyoruz.');
        expect(memory.instruction()).toContain('Do not ask for the same information again');
    });

    it('does not resolve interrupted questions or a visitor clarification question', () => {
        const memory = createResolvedTurnMemory();
        expect(memory.record({
            question: 'En çok nerede zaman kaybediyorsunuz?',
            answer: 'Yanıt takibinde.',
            interrupted: true
        })).toBe(false);
        expect(memory.record({
            question: 'En çok nerede zaman kaybediyorsunuz?',
            answer: 'Hangi süreci kastediyorsunuz?'
        })).toBe(false);
        expect(memory.snapshot()).toEqual([]);
    });

    it('deduplicates identical final transcripts and keeps later corrections', () => {
        const memory = createResolvedTurnMemory();
        const exchange = {
            question: 'Bir sistem kullanıyor musunuz?',
            answer: 'Hayır, kullanmıyoruz.'
        };
        expect(memory.record(exchange)).toBe(true);
        expect(memory.record(exchange)).toBe(false);
        expect(memory.record({
            question: exchange.question,
            answer: 'Aslında e-posta kullanıyoruz.'
        })).toBe(true);
        expect(memory.snapshot()).toHaveLength(2);
        expect(memory.instruction()).toContain('A later explicit correction overrides');
    });
});
