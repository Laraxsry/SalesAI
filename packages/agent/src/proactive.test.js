import { describe, it, expect } from 'vitest';
import { buildIdleNudgeInstructions, wrapDirective } from './proactive.js';

describe('buildIdleNudgeInstructions', () => {
    it('hands the model the turn without scripting a line for it', () => {
        const text = buildIdleNudgeInstructions();
        expect(text.length).toBeGreaterThan(0);
        // A canned "are you still there?" is the failure mode this replaces.
        expect(text.toLowerCase()).toContain('do not remark on the silence');
    });

    it('escalates across consecutive unanswered nudges', () => {
        const first = buildIdleNudgeInstructions({ consecutive: 1 });
        const second = buildIdleNudgeInstructions({ consecutive: 2 });
        const third = buildIdleNudgeInstructions({ consecutive: 3 });

        expect(new Set([first, second, third]).size).toBe(3);
        // By the third, the likeliest explanation is nobody is listening —
        // asking another question just talks into an empty room.
        expect(third.toLowerCase()).toContain('do not ask another question');
    });

    it('never leaks the existence of a plan or step numbering', () => {
        for (const consecutive of [1, 2, 3, 9]) {
            const text = buildIdleNudgeInstructions({ consecutive }).toLowerCase();
            expect(text).not.toContain('step');
            expect(text).not.toContain('playbook');
            expect(text).not.toContain('plan');
        }
    });
});

describe('wrapDirective', () => {
    const node = { directive: 'Şirketi tanıt: kuruluş yılı, kaç ülkede faaliyet', attach: null, url: null };

    it('carries the directive through verbatim', () => {
        expect(wrapDirective(node)).toContain(node.directive);
    });

    it('frames the directive as a private note, never as a line to read', () => {
        // The whole point: a voice model handed a raw colon-list will read the
        // colon-list. If this framing is dropped the demo sounds like someone
        // reciting a checklist.
        const text = wrapDirective(node).toLowerCase();
        expect(text).toContain('never read it aloud');
        expect(text).toContain('private note');
    });

    it('never reveals that a plan exists', () => {
        const text = wrapDirective(node).toLowerCase();
        expect(text).not.toContain('step');
        expect(text).not.toContain('playbook');
        expect(text).not.toContain('next topic');
    });

    it('contains no other step than the one it was given', () => {
        const decoy = 'ZZZ_OTHER_STEP_ZZZ';
        const text = wrapDirective({ ...node, directive: 'Sadece bunu anlat' });
        expect(text).not.toContain(decoy);
        expect(text).toContain('Sadece bunu anlat');
    });

    it('adds screen framing only when a page is actually visible', () => {
        expect(wrapDirective(node, { screenVisible: true })).toContain('already open');
        expect(wrapDirective(node, { screenVisible: false })).not.toContain('already open');
    });

    it('asks for the click when the step has an attach target and the screen is visible', () => {
        const withAttach = wrapDirective({ ...node, attach: 'Rapor Ekle butonu' }, { screenVisible: true });
        expect(withAttach).toContain('Rapor Ekle butonu');
        expect(withAttach).toContain('click_element');

        expect(wrapDirective(node, { screenVisible: true })).not.toContain('click_element');
    });

    it('never asks for the click when the screen isn\'t actually visible, even with an attach target', () => {
        // Navigation can fail or still be in flight — sending the model
        // hunting for an element on a page that isn't rendered is a
        // guaranteed, pointless click_element timeout instead of just
        // narrating the content it already has.
        const withAttach = wrapDirective({ ...node, attach: 'Rapor Ekle butonu' }, { screenVisible: false });
        expect(withAttach).not.toContain('click_element');
        expect(withAttach).not.toContain('Rapor Ekle butonu');
    });

    it('tells the model to continue rather than restart when resuming', () => {
        const resumed = wrapDirective(node, { resuming: true }).toLowerCase();
        expect(resumed).toContain('do not start over');
        expect(wrapDirective(node).toLowerCase()).not.toContain('do not start over');
    });
});
