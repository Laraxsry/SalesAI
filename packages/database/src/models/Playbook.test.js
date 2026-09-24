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

describe('Playbook dynamic requirement persistence schema', () => {
    it('keeps an explicit requirement without deriving it from legacy mode', () => {
        const playbook = new Playbook({
            agentId: '507f1f77bcf86cd799439011',
            nodes: [{
                id: 'closing',
                order: 1,
                directive: 'İletişim ve uygunluk bilgisi iste',
                mode: 'important',
                requirement: 'required_before_close'
            }]
        });

        const node = playbook.toObject().nodes[0];
        expect(node.mode).toBe('important');
        expect(node.requirement).toBe('required_before_close');
    });

    it('leaves legacy important nodes without an inferred requirement', () => {
        const playbook = new Playbook({
            agentId: '507f1f77bcf86cd799439011',
            nodes: [{
                id: 'legacy',
                order: 1,
                directive: 'Önemli eski adım',
                mode: 'important'
            }]
        });

        expect(playbook.toObject().nodes[0].requirement).toBeNull();
    });
});
