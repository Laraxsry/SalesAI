import { describe, expect, it } from 'vitest';
import { ConversationMemoryInput } from '@repo/contracts';
import { evaluateSurveyProposal } from './adaptive-survey-gate.js';

function proposal(overrides = {}) {
    return {
        proposalId: 'survey-industry-1',
        baseRevision: 2,
        epoch: 4,
        purpose: 'demo_routing',
        questionKey: 'company.industry',
        question: 'Şirketiniz hangi sektörde faaliyet gösteriyor?',
        reason: 'Demo rotası sektöre göre değişiyor.',
        answerType: 'single_select',
        options: [
            { value: 'finance', label: 'Finans' },
            { value: 'saas', label: 'SaaS' }
        ],
        requiredFor: ['demo_route'],
        blocking: false,
        confidenceThatUnknown: 0.95,
        ...overrides
    };
}

function factResolution(status = 'unknown', overrides = {}) {
    return {
        key: 'company.industry', status, fact: null, candidates: [],
        reason: status === 'unknown' ? 'no_known_fact' : `${status}_fact`,
        ...overrides
    };
}

function input(overrides = {}) {
    return {
        proposal: proposal(),
        policy: {},
        fieldDefinitions: [{
            key: 'company.industry', importance: 'recommended',
            affects: ['demo_route'], preferredInput: 'single_select'
        }],
        factResolution: factResolution(),
        memory: ConversationMemoryInput.parse({ turnIndex: 10 }),
        runtime: {
            routeRevision: 2, epoch: 4, activeSurveyId: null,
            shownCount: 0, lastSurveyTurn: null
        },
        ...overrides
    };
}

describe('adaptive survey gate', () => {
    it('approves a relevant unknown field without granting blocking authority', () => {
        const result = evaluateSurveyProposal(input());
        expect(result).toMatchObject({
            status: 'approved', reason: 'policy_passed', channel: 'survey',
            proposal: { questionKey: 'company.industry', blocking: false }
        });
    });

    it('refuses fields absent from the company allowlist', () => {
        expect(evaluateSurveyProposal(input({ fieldDefinitions: [] })).reason)
            .toBe('field_not_allowlisted');
    });

    it('rejects prohibited, known, repeated, stale, and do-not-ask fields', () => {
        expect(evaluateSurveyProposal(input({
            proposal: proposal({ questionKey: 'customer.password' }),
            factResolution: factResolution('unknown', { key: 'customer.password' })
        })).reason).toBe('prohibited_field');
        expect(evaluateSurveyProposal(input({
            factResolution: factResolution('known', {
                fact: {
                    key: 'company.industry', value: 'saas', source: 'crm',
                    confidence: 0.95, capturedTurnIndex: 0, evidenceRef: null
                }
            })
        })).reason).toBe('fact_already_known');
        expect(evaluateSurveyProposal(input({
            memory: ConversationMemoryInput.parse({
                turnIndex: 10,
                askedQuestions: {
                    'company.industry': {
                        questionKey: 'company.industry', channel: 'survey',
                        status: 'dismissed', askedTurnIndex: 4, answerRef: null
                    }
                }
            })
        })).reason).toBe('question_already_dismissed');
        expect(evaluateSurveyProposal(input({
            proposal: proposal({ baseRevision: 1 })
        })).reason).toBe('stale_route_revision');
        expect(evaluateSurveyProposal(input({
            fieldDefinitions: [{
                key: 'company.industry', importance: 'do_not_ask',
                affects: ['demo_route']
            }]
        })).reason).toBe('field_marked_do_not_ask');
    });

    it('routes medium-confidence or conflicting facts to voice verification', () => {
        const result = evaluateSurveyProposal(input({
            factResolution: factResolution('verify', {
                fact: {
                    key: 'company.industry', value: 'saas', source: 'conversation',
                    confidence: 0.7, capturedTurnIndex: 2, evidenceRef: null
                }
            })
        }));
        expect(result).toMatchObject({
            status: 'verify_voice', reason: 'confirm_existing_fact',
            questionKey: 'company.industry'
        });
    });

    it('defers for answer-first, cooldown, active survey, and source outage', () => {
        expect(evaluateSurveyProposal(input({ hasOpenCustomerQuestion: true })).reason)
            .toBe('answer_first_required');
        expect(evaluateSurveyProposal(input({
            runtime: {
                routeRevision: 2, epoch: 4, activeSurveyId: null,
                shownCount: 0, lastSurveyTurn: 8
            }
        })).reason).toBe('survey_cooldown');
        expect(evaluateSurveyProposal(input({
            runtime: {
                routeRevision: 2, epoch: 4, activeSurveyId: 'survey-existing',
                shownCount: 1, lastSurveyTurn: 4
            }
        })).reason).toBe('another_survey_active');
        expect(evaluateSurveyProposal(input({
            factResolution: factResolution('unavailable')
        })).reason).toBe('fact_source_unavailable');
    });

    it('prefers voice when the authoring definition asks for lower friction', () => {
        const result = evaluateSurveyProposal(input({
            fieldDefinitions: [{
                key: 'company.industry', importance: 'recommended',
                affects: ['demo_route'], preferredInput: 'voice'
            }]
        }));
        expect(result).toMatchObject({ status: 'approved', channel: 'voice' });
    });
});
