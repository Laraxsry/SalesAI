import { describe, expect, it } from 'vitest';
import { createSurveyReviewerPipeline } from './survey-reviewer-pipeline.js';
import {
    createKnownFactSurveyReviewer,
    createConversationTimingSurveyReviewer
} from './survey-quality-reviewers.js';
import { createModelSurveyReviewer } from './model-survey-reviewer.js';

describe('survey advisory reviewers', () => {
    it('flags known facts and bad timing without modifying the proposal', async () => {
        const context = {
            proposal: { questionKey: 'company.industry' },
            factResolution: { status: 'known' },
            state: { adaptiveSurvey: { activeSurveyId: null } },
            hasOpenCustomerQuestion: true
        };
        const reviews = await createSurveyReviewerPipeline({
            reviewers: [createKnownFactSurveyReviewer(), createConversationTimingSurveyReviewer()]
        }).review(context);
        expect(reviews).toEqual([
            { id: 'known_fact', status: 'flagged', reason: 'fact_known' },
            { id: 'conversation_timing', status: 'flagged', reason: 'answer_first' }
        ]);
        expect(context.proposal).toEqual({ questionKey: 'company.industry' });
    });

    it('fails open for throwing and timed-out reviewers', async () => {
        const reviews = await createSurveyReviewerPipeline({ timeoutMs: 5, reviewers: [
            { id: 'throws', review: () => { throw new Error('offline'); } },
            { id: 'slow', review: () => new Promise(() => {}) },
            createKnownFactSurveyReviewer()
        ] }).review({ factResolution: { status: 'unknown' } });
        expect(reviews.map(({ status }) => status))
            .toEqual(['skipped_error', 'skipped_timeout', 'passed']);
    });

    it('keeps the optional model critic disabled until explicitly enabled', async () => {
        let calls = 0;
        const critic = createModelSurveyReviewer({
            model: 'critic-v1', invoke: () => { calls++; return { status: 'flagged' }; }
        });
        const reviews = await createSurveyReviewerPipeline({ reviewers: [critic] })
            .review({ proposal: { questionKey: 'company.industry' } });
        expect(reviews).toEqual([{ id: 'model_critic', status: 'skipped_disabled' }]);
        expect(calls).toBe(0);
    });

    it('sends only bounded structural signals and rejects invalid critic output', async () => {
        let received;
        const critic = createModelSurveyReviewer({
            model: 'critic-v1', enabled: () => true,
            invoke: (input) => { received = input; return { status: 'approve_anyway' }; }
        });
        const reviews = await createSurveyReviewerPipeline({ reviewers: [critic] })
            .review({
                proposal: { purpose: 'demo_routing', questionKey: 'company.industry',
                    question: 'Jane, your private industry?', reason: 'jane@example.com' },
                factResolution: { status: 'known', fact: { value: 'private-finance' } },
                state: { adaptiveSurvey: { activeSurveyId: null, shownCount: 1 },
                    memory: { discoveredFacts: { secret: 'private-finance' } } },
                hasOpenCustomerQuestion: true
            });
        expect(received.input).toMatchObject({
            questionKey: 'company.industry', factStatus: 'known',
            hasOpenCustomerQuestion: true
        });
        expect(JSON.stringify(received)).not.toMatch(/Jane|jane@example.com|private-finance/);
        expect(reviews).toEqual([{ id: 'model_critic', status: 'skipped_invalid_output' }]);
    });

    it('aborts a timed-out model critic without changing gate authority', async () => {
        let aborted = false;
        const critic = createModelSurveyReviewer({
            model: 'critic-v1', enabled: () => true, timeoutMs: 5,
            invoke: ({ signal }) => {
                signal.addEventListener('abort', () => { aborted = true; });
                return new Promise(() => {});
            }
        });
        const reviews = await createSurveyReviewerPipeline({ reviewers: [critic] })
            .review({ proposal: {} });
        expect(reviews).toEqual([{ id: 'model_critic', status: 'skipped_timeout' }]);
        expect(aborted).toBe(true);
    });
});
