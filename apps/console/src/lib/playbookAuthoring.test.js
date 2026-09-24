import { describe, expect, it } from 'vitest';
import {
    authoringFieldsForImportance,
    buildPlaybookBehaviorPreview,
    importanceFromPlaybookNode,
    summarizePlaybookAuthoring
} from './playbookAuthoring.js';

describe('playbook authoring projection', () => {
    it('does not silently upgrade legacy important nodes to mandatory closing', () => {
        expect(importanceFromPlaybookNode({ mode: 'important', requirement: null }))
            .toBe('important');
        expect(authoringFieldsForImportance('important')).toEqual({
            mode: 'important', requirement: 'required_if_relevant'
        });
    });

    it('maps an explicit closing choice to the obligation bridge', () => {
        expect(authoringFieldsForImportance('closing')).toEqual({
            mode: 'important', requirement: 'required_before_close'
        });
        expect(importanceFromPlaybookNode({
            mode: 'situational', requirement: 'required_before_close'
        })).toBe('closing');
    });

    it('builds a human-readable behavior preview without runtime states', () => {
        const preview = buildPlaybookBehaviorPreview([{
            id: 'close',
            type: 'narrative',
            directive: 'Demo görüşmesi için uygun günü belirle',
            requirement: 'required_before_close',
            url: 'https://example.test/demo',
            actions: ['Takvim alanını göster']
        }]);

        expect(preview[0]).toMatchObject({
            importance: 'closing',
            importanceLabel: 'Kapanıştan önce tamamla',
            objective: 'Demo görüşmesi için uygun günü belirle'
        });
        expect(preview[0].behavior).not.toMatch(/state|node|obligation/i);
        expect(preview[0].screenBehavior).toContain('ürün sayfasını');
    });

    it('summarizes explicit closing, screen and survey goals', () => {
        expect(summarizePlaybookAuthoring([
            { type: 'survey', requirement: 'preferred', survey: { question: 'Sektörünüz?' } },
            { type: 'narrative', requirement: 'required_before_close', url: '/demo' }
        ])).toEqual({ stepCount: 2, closingCount: 1, screenStepCount: 1, surveyCount: 1 });
    });
});
