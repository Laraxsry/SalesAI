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

describe('buildSystemPrompt — how the agent sounds', () => {
    // The complaint this whole block exists for: asked a question, the agent
    // said the equivalent of "let me check whether that exists in my database"
    // — narrating its own machinery, which is the single loudest "this is a
    // bot" signal a visitor gets.
    it('forbids the model from narrating its own machinery', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('NEVER mention or hint at how you work');
        expect(prompt).toContain('no databases');
        expect(prompt).toContain('never hear you describe your own process');
    });

    it('asks for a human beat instead of silence, without letting it become a tic', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('never the same words twice in a row');
    });

    it('bans the sales-training register that made it sound like a brochure', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).not.toContain('surface relevant features');
        expect(prompt).not.toContain('handle objections');
        expect(prompt).toContain('not a rundown of everything the product can do');
    });

    it('rules out repeating itself and stacking benefits', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('Never say something you have already said');
        expect(prompt).toContain('One idea per turn');
    });

    it('still never leaks that a plan exists, with the new block in place', () => {
        const prompt = buildSystemPrompt({ ...baseCfg, playbookActive: true }).toLowerCase();
        expect(prompt).not.toContain('playbook');
    });
});

describe('buildSystemPrompt — conversational behavior rules', () => {
    it('never lets the model narrate that it is checking/searching an internal system, in either mode', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        for (const prompt of [withoutPlaybook, withPlaybook]) {
            expect(prompt).toContain('NEVER narrate that you are searching, checking, or looking something up');
        }
    });

    it('tells the model to drive a continuous walkthrough without stopping to wait, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain("Drive a continuous walkthrough, don't stop-and-wait");
        expect(withPlaybook).not.toContain("Drive a continuous walkthrough, don't stop-and-wait");
    });

    it('tells the model to NEVER ask the customer what to do next/where to continue, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain('NEVER ask the customer what to do next or where to continue');
        expect(withPlaybook).not.toContain('NEVER ask the customer what to do next or where to continue');
    });

    it('tells the model never to preview a multi-step agenda out loud when transitioning', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('Never announce your plan');
        expect(prompt.toLowerCase()).toContain('first i\'ll show you x, then y');
    });

    it('tells the model to fill slow navigation with a line instead of silence, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain('that must not be silence');
        expect(withPlaybook).not.toContain('that must not be silence');
    });

    it('tells the model not to call read_tour_screen right after start_guided_tour/navigate_to, and not to retry-loop it, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain("Don't call `read_tour_screen` in that same breath");
        expect(withoutPlaybook).toContain("don't immediately retry the same question");
        expect(withPlaybook).not.toContain("Don't call `read_tour_screen` in that same breath");
    });

    it('tells the model that contact-info confirmation is the one exception where it actually waits for a real answer', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('the ONE place where you genuinely wait for a real answer');
        expect(prompt).toContain('Silence after you ask them to confirm is NOT a yes');
        // The "never ask what to do next" rule must not read as contradicting this.
        expect(prompt).toContain('does NOT apply to confirming contact info');
    });

    it('tells the model to call expect_response right when it asks for contact-info confirmation', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('The moment you ask them to confirm, call `expect_response`');
    });

    it('tells the model to resume the prior thread after an interruption, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain("picking back up where you left off");
        expect(withPlaybook).not.toContain("picking back up where you left off");
    });

    it('tells the model to verify a visual claim with read_tour_screen instead of assuming it from knowledge-base text', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('Never assert a specific visual detail');
        expect(prompt).toContain('call `read_tour_screen`');
    });

    it('tells the model to keep the screen in sync and navigate to a search_knowledge result\'s pageUrl before describing it, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain('Keep the screen in sync with your own words');
        expect(withoutPlaybook).toContain('`navigate_to` it FIRST');
        expect(withoutPlaybook).toContain('Never narrate specifics of a page the visitor cannot currently see');
        expect(withPlaybook).not.toContain('Keep the screen in sync with your own words');
    });

    it('tells the model this screen-sync rule applies to short factual answers too, not just long walkthroughs', () => {
        const prompt = buildSystemPrompt(baseCfg);
        expect(prompt).toContain('This applies to short factual answers too');
        expect(prompt).toContain("don't just recite the fact from memory over voice");
    });

    it('tells the model never to narrate its own reasoning/planning process out loud, in either mode', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        for (const prompt of [withoutPlaybook, withPlaybook]) {
            expect(prompt).toContain('NEVER narrate your own reasoning or plan of action out loud');
        }
    });

    it('tells the model to click a search_knowledge result\'s tabLabel before expecting to see its content, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain('`tabLabel`, its content is behind a specific tab/panel selector');
        expect(withPlaybook).not.toContain('`tabLabel`, its content is behind a specific tab/panel selector');
    });

    it('tells the model not to re-ask read_tour_screen the same question when content is missing, but to navigate to the right page instead, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain("that means you're on the WRONG page");
        expect(withPlaybook).not.toContain("that means you're on the WRONG page");
    });

    it('tells the model that some clicks change content on the same page without a URL change, only outside a playbook', () => {
        const withoutPlaybook = buildSystemPrompt(baseCfg);
        const withPlaybook = buildSystemPrompt({ ...baseCfg, playbookActive: true });
        expect(withoutPlaybook).toContain("doesn't mean nothing happened");
        expect(withPlaybook).not.toContain("doesn't mean nothing happened");
    });
});
