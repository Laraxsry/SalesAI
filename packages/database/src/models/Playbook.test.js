import { describe, expect, it } from 'vitest';
import { Playbook } from './Playbook.js';

describe('Playbook survey persistence schema', () => {
    it('keeps fieldKey through Mongoose document serialization', () => {
        const playbook = new Playbook({
            agentId: '507f1f77bcf86cd799439011',
            nodes: [{
                id: 'priority',
                order: 1,
                type: 'survey',
                directive: 'Önceliğiniz nedir?',
                survey: {
                    question: 'Önceliğiniz nedir?',
                    fieldKey: 'qualification.priority',
                    answerType: 'text'
                }
            }]
        });

        expect(playbook.toObject().nodes[0].survey.fieldKey)
            .toBe('qualification.priority');
    });
});
