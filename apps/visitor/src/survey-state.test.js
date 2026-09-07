import { describe, expect, it } from 'vitest';
import { applySurveyMessage, decodeSurveyMessage } from './survey-state.js';

const encode = (value) => new TextEncoder().encode(JSON.stringify(value));

describe('in-call survey messages', () => {
    it('accepts a bounded show message', () => {
        const state = applySurveyMessage(null, encode({
            type: 'salesai:survey',
            action: 'show',
            nodeId: 'broker',
            question: 'Hangi aracı kurumu kullanıyorsunuz?',
            answerType: 'single-choice',
            options: [
                { value: 'midas', label: 'Midas' },
                { value: 'papara', label: 'Papara' }
            ],
            required: true
        }));
        expect(state).toMatchObject({
            nodeId: 'broker',
            options: [
                { value: 'midas', label: 'Midas' },
                { value: 'papara', label: 'Papara' }
            ],
            required: true
        });
    });

    it('hides only the matching active survey', () => {
        const current = { nodeId: 'broker', question: 'Soru' };
        expect(applySurveyMessage(current, encode({
            type: 'salesai:survey', action: 'hide', nodeId: 'other'
        }))).toBe(current);
        expect(applySurveyMessage(current, encode({
            type: 'salesai:survey', action: 'hide', nodeId: 'broker'
        }))).toBeNull();
    });

    it('ignores malformed and unrelated messages', () => {
        expect(decodeSurveyMessage(new TextEncoder().encode('nope'))).toBeNull();
        const current = { nodeId: 'broker' };
        expect(applySurveyMessage(current, encode({ type: 'salesai:meeting' }))).toBe(current);
    });
});
