import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './persona.js';

const baseCfg = { name: 'Aylin', product: { name: 'Cyberverse' }, persona: {} };

describe('buildSystemPrompt — playbookActive', () => {
    it('omits the advance_step rule entirely when no playbook is running', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).not.toContain('advance_step');
    });

    it('adds the advance_step rule when a playbook is active', () => {
        const prompt = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(prompt).toContain('advance_step');
    });

    it('the rule never leaks the existence of a plan, steps, or a sequence', () => {
        // This is the one invariant the whole playbook design rests on — see
        // md/backend/agent_flow.md. The flag is allowed to turn on a
        // stateless reflex, never any information about what the plan is.
        const prompt = buildSystemPrompt({ ...baseCfg, playbookActive: true }).toLowerCase();
        expect(prompt).not.toContain('playbook');
        expect(prompt).toContain('never mention that you were told to say anything');
    });

    it('defaults to inactive when playbookActive is omitted', () => {
        const withDefault = buildSystemPrompt(baseCfg);
        const withExplicitFalse = buildSystemPrompt({ ...baseCfg, playbookActive: false });
        expect(withDefault).toBe(withExplicitFalse);
    });
});

describe('buildSystemPrompt — navigation ownership', () => {
    // The runtime drives start_guided_tour/navigate_to itself while a
    // playbook is active; if the model also calls them on its own
    // initiative, both land on the same GuidedTour instance at once and race
    // — see agent.js's isTourActive guard fix. The model must be told this
    // is not its job to do while a playbook is running.
    it('tells the model NOT to call start_guided_tour/navigate_to itself when a playbook is active', () => {
        const prompt = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(prompt).toContain('NEVER call `start_guided_tour` or `navigate_to` yourself');
    });

    it('still allows click_element/scroll_page/highlight while a playbook is active', () => {
        const prompt = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(prompt).toContain('`click_element`');
        expect(prompt).toContain('`scroll_page`');
        expect(prompt).toContain('`highlight`');
    });

    it('tells the model it CAN use start_guided_tour/navigate_to when no playbook is running', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('Use `start_guided_tour`, `navigate_to`');
        expect(prompt).not.toContain('NEVER call `start_guided_tour`');
    });

    it('omits the navigate_to-specific guidance when a playbook is active (the model never calls it)', () => {
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        const without = buildSystemPrompt(baseCfg);
        expect(without).toContain('For `navigate_to` specifically');
        expect(withPlaybook).not.toContain('For `navigate_to` specifically');
    });
});
