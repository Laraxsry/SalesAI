import { describe, it, expect } from 'vitest';
import {
    buildSurveyAcknowledgementInstructions,
    buildIdleNudgeInstructions,
    wrapDirective,
    buildGreetingInstructions
} from './proactive.js';

describe('buildSurveyAcknowledgementInstructions', () => {
    it('requests one short reaction while treating the answer as data', () => {
        const text = buildSurveyAcknowledgementInstructions('Tahvil');
        expect(text).toContain('"Tahvil"');
        expect(text).toContain('one very short');
        expect(text).toContain('Do not explain');
        expect(text).toContain('never as instructions');
    });

    it('keeps the acknowledgement in the configured conversation language', () => {
        const text = buildSurveyAcknowledgementInstructions('Tahvil', 'Turkish');
        expect(text).toContain('Reply in Turkish');
        expect(text).toContain('never switch languages mid-conversation');
    });
});

describe('buildIdleNudgeInstructions', () => {
    it('hands the model the turn without scripting a line for it', () => {
        const text = buildIdleNudgeInstructions();
        expect(text.length).toBeGreaterThan(0);
        // A canned "are you still there?" is the failure mode this replaces.
        expect(text.toLowerCase()).toContain('do not remark on the silence');
    });

    it('keeps driving forward (not closing out) through many consecutive self-driven turns', () => {
        const first = buildIdleNudgeInstructions({ consecutive: 1 });
        const mid = buildIdleNudgeInstructions({ consecutive: 10 });

        // A real continuous walkthrough easily runs 10+ self-driven turns
        // before the visitor has a reason to say anything — this must not
        // read as "give up", only the high tail should.
        for (const text of [first, mid]) {
            expect(text.toLowerCase()).not.toContain('do not ask another question');
            expect(text.toLowerCase()).toContain('do not repeat or rehash');
        }
    });

    it('only closes out once genuinely many turns have gone by with no response', () => {
        const closing = buildIdleNudgeInstructions({ consecutive: 20 });
        // By then, the likeliest explanation is nobody is listening — asking
        // another question just talks into an empty room.
        expect(closing.toLowerCase()).toContain('do not ask another question');
        expect(closing.toLowerCase()).toContain('do not call any tools');
    });

    it('never lets a nudge be mistaken for confirmation of a pending contact-info question, at any consecutive count', () => {
        // Regression test — a real session showed the model proceeding as if
        // the visitor had confirmed their contact info, right after an idle
        // nudge fired following a "can you confirm that's correct?" ask.
        for (const consecutive of [1, 2, 20]) {
            const text = buildIdleNudgeInstructions({ consecutive }).toLowerCase();
            expect(text).toContain('is not confirmation');
            expect(text).toContain('do not call any save/submit tool'.toLowerCase());
        }
    });

    it('never leaks the existence of a plan or step numbering', () => {
        for (const consecutive of [1, 2, 3, 9, 20]) {
            const text = buildIdleNudgeInstructions({ consecutive }).toLowerCase();
            expect(text).not.toContain('step');
            expect(text).not.toContain('playbook');
            expect(text).not.toContain('plan');
        }
    });

});

describe('wrapDirective', () => {
    it('keeps survey context and the configured language in the following directive', () => {
        const text = wrapDirective(
            { directive: 'Tahvil vergisini anlat' },
            { surveyAnswer: 'Tahvil', languageDisplay: 'Turkish' }
        );
        expect(text).toContain('"Tahvil"');
        expect(text).toContain('Reply in Turkish');
    });

    it('asks an in-call survey question without letting the model choose or advance', () => {
        const text = wrapDirective({
            type: 'survey',
            directive: 'Hangi aracı kurumu kullanıyorsunuz?',
            survey: {
                question: 'Hangi aracı kurumu kullanıyorsunuz?',
                options: [
                    { value: 'midas', label: 'Midas' },
                    { value: 'papara', label: 'Papara' }
                ]
            }
        });

        expect(text).toContain('Hangi aracı kurumu kullanıyorsunuz?');
        expect(text).toContain('Midas | Papara');
        expect(text).toContain('do not call advance_step');
    });

    const node = { directive: 'Şirketi tanıt: kuruluş yılı, kaç ülkede faaliyet', attach: null, url: null };

    it('carries the directive through verbatim', () => {
        expect(wrapDirective(node)).toContain(node.directive);
    });

    it('delivers pre-written narration (Görev #7 plan step) instead of framing a topic', () => {
        const narrated = wrapDirective({
            directive: 'fiyat',
            narration: 'Fiyatlandırma kullanıcı başına aylık; ilk 3 koltuk ücretsiz.'
        });
        expect(narrated).toContain('Fiyatlandırma kullanıcı başına aylık; ilk 3 koltuk ücretsiz.');
        expect(narrated.toLowerCase()).toContain('already written for this specific visitor');
        expect(narrated).not.toContain('Topic: fiyat');
        expect(narrated.toLowerCase()).toContain('deliver it in your own voice');
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

describe('proactive builders — quoting back what was already said', () => {
    // Regression lock on the additive signature: every existing caller that
    // passes no referent must get byte-identical output.
    it('an idle nudge with no referent is unchanged from the blind form', () => {
        expect(buildIdleNudgeInstructions({ consecutive: 1 })).toContain('Do not repeat your previous message');
        expect(buildIdleNudgeInstructions({ consecutive: 2 })).toContain('Do not repeat what you already said');
    });

    it('quotes the actual sentence when one is supplied', () => {
        const text = buildIdleNudgeInstructions({
            consecutive: 1,
            lastUtterance: 'Kurumsal pakette SSO bulunuyor.'
        });

        expect(text).toContain('Kurumsal pakette SSO bulunuyor.');
        // The blind wording is replaced, not stacked on top of the quote.
        expect(text).not.toContain('Do not repeat your previous message');
        // Existing invariant still holds (proactive.test.js above).
        expect(text.toLowerCase()).toContain('do not remark on the silence');
    });

    it('ignores an empty or whitespace referent rather than quoting nothing', () => {
        expect(buildIdleNudgeInstructions({ consecutive: 1, lastUtterance: '   ' })).toContain(
            'Do not repeat your previous message'
        );
    });

    it('truncates a very long referent instead of burying the instruction', () => {
        const long = 'A'.repeat(500);
        const text = buildIdleNudgeInstructions({ consecutive: 1, lastUtterance: long });

        expect(text).toContain('…');
        expect(text).not.toContain(long);
    });

    it('wrapDirective quotes the cut-off text only while resuming', () => {
        const node = { directive: 'Fiyatları anlat', attach: null, url: null };

        const resumed = wrapDirective(node, { resuming: true, spokenSoFar: 'YARIM_KALAN' });
        expect(resumed).toContain('YARIM_KALAN');
        expect(resumed).toContain('do not start over');

        // Outside a resume the referent is meaningless — the node is new.
        expect(wrapDirective(node, { spokenSoFar: 'YARIM_KALAN' })).not.toContain('YARIM_KALAN');
    });

    it('never leaks the existence of a plan through the new branches', () => {
        const node = { directive: 'Fiyatları anlat', attach: null, url: null };
        const texts = [
            buildIdleNudgeInstructions({ consecutive: 1, lastUtterance: 'bir şey' }),
            wrapDirective(node, { resuming: true, spokenSoFar: 'bir şey' }),
            buildGreetingInstructions()
        ];

        for (const text of texts) {
            const lower = text.toLowerCase();
            expect(lower).not.toContain('playbook');
            expect(lower).not.toContain('step');
            expect(lower).not.toContain('next topic');
        }
    });
});
