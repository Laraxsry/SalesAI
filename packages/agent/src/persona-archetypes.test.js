import { describe, it, expect } from 'vitest';
import { PERSONA_ARCHETYPES, renderArchetype } from './persona-archetypes.js';

describe('PERSONA_ARCHETYPES', () => {
    it('defines exactly marketing and technical', () => {
        expect(Object.keys(PERSONA_ARCHETYPES).sort()).toEqual(['marketing', 'technical']);
    });

    it.each(Object.keys(PERSONA_ARCHETYPES))('%s has concrete rules and a demonstration example', (key) => {
        const def = PERSONA_ARCHETYPES[key];
        expect(def.rules.length).toBeGreaterThan(0);
        expect(def.example.length).toBeGreaterThan(0);
        // Guards against regressing to vague adjectives — every rule must
        // describe an observable action, not just a trait.
        def.rules.forEach((rule) => expect(typeof rule).toBe('string'));
    });
});

describe('renderArchetype', () => {
    it('returns an empty string for "custom" — callers fall back to the free-text tone sentence', () => {
        expect(renderArchetype('custom')).toBe('');
    });

    it('returns an empty string for undefined/unknown keys (never throws)', () => {
        expect(renderArchetype(undefined)).toBe('');
        expect(renderArchetype('not-a-real-archetype')).toBe('');
    });

    it('renders every marketing rule and the example dialogue', () => {
        const block = renderArchetype('marketing');
        PERSONA_ARCHETYPES.marketing.rules.forEach((rule) => expect(block).toContain(rule));
        expect(block).toContain(PERSONA_ARCHETYPES.marketing.example);
    });

    it('renders every technical rule and the example dialogue', () => {
        const block = renderArchetype('technical');
        PERSONA_ARCHETYPES.technical.rules.forEach((rule) => expect(block).toContain(rule));
        expect(block).toContain(PERSONA_ARCHETYPES.technical.example);
    });

    it('marks the example as non-verbatim so the model does not memorize it as a script', () => {
        expect(renderArchetype('marketing')).toContain('never reuse this exact wording verbatim');
        expect(renderArchetype('technical')).toContain('never reuse this exact wording verbatim');
    });
});
