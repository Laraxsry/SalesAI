import { describe, expect, it } from 'vitest';
import { toEditorSurvey } from './playbookSurvey.js';

describe('toEditorSurvey', () => {
    it('preserves fieldKey while mapping a generated or persisted survey', () => {
        const options = [{ value: 'now', label: 'Bu ay' }];
        expect(toEditorSurvey({
            question: 'Ne zaman değerlendirmeyi planlıyorsunuz?',
            fieldKey: 'qualification.timeline',
            answerType: 'single-choice',
            options,
            allowFreeText: true,
            required: false
        }, options)).toEqual({
            question: 'Ne zaman değerlendirmeyi planlıyorsunuz?',
            fieldKey: 'qualification.timeline',
            answerType: 'single-choice',
            options,
            allowFreeText: true,
            required: false
        });
    });
});
