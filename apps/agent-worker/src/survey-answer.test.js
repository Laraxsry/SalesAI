import { describe, expect, it } from 'vitest';
import { buildSurveyAnswerRecord, normalizeSurveyAnswer } from './survey-answer.js';

const node = {
    id: 'broker',
    type: 'survey',
    survey: {
        fieldKey: 'broker',
        answerType: 'single-choice',
        options: [
            { value: 'midas', label: 'Midas' },
            { value: 'papara', label: 'Papara' }
        ],
        allowFreeText: false,
        required: true
    }
};

describe('normalizeSurveyAnswer', () => {
    it('returns the stable value and human label for an allowed option', () => {
        expect(normalizeSurveyAnswer(node, {
            nodeId: 'broker', answer: 'midas'
        })).toEqual({ answer: 'Midas', answerValue: 'midas', skipped: false });
    });

    it('rejects stale node ids and invented option values', () => {
        expect(normalizeSurveyAnswer(node, { nodeId: 'old', answer: 'midas' })).toBeNull();
        expect(normalizeSurveyAnswer(node, { nodeId: 'broker', answer: 'other' })).toBeNull();
    });

    it('allows skipping only when the node is optional', () => {
        expect(normalizeSurveyAnswer(node, { nodeId: 'broker', skipped: true })).toBeNull();
        expect(normalizeSurveyAnswer(
            { ...node, survey: { ...node.survey, required: false } },
            { nodeId: 'broker', skipped: true }
        )).toEqual({ answer: null, answerValue: null, skipped: true });
    });
});

describe('buildSurveyAnswerRecord', () => {
    it('keeps the machine key and human question in one canonical record', () => {
        const answeredAt = new Date('2026-09-08T10:00:00.000Z');
        expect(buildSurveyAnswerRecord(
            { ...node, survey: { ...node.survey, question: 'Hangi aracı kurumu kullanıyorsunuz?' } },
            { answer: 'Midas', answerValue: 'midas', skipped: false },
            { answerId: 'answer-1', participant: 'visitor-1', answeredAt }
        )).toEqual({
            answerId: 'answer-1',
            nodeId: 'broker',
            fieldKey: 'broker',
            question: 'Hangi aracı kurumu kullanıyorsunuz?',
            answer: 'Midas',
            answerValue: 'midas',
            skipped: false,
            participant: 'visitor-1',
            answeredAt
        });
    });
});
