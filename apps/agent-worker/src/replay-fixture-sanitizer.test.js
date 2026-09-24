import { describe, expect, it } from 'vitest';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { sanitizeReplaySession } from './replay-fixture-sanitizer.js';
import { evaluateDynamicPlaybookTimeline } from './dynamic-playbook-eval.js';

const SALT = 'unit-test-salt-at-least-16-characters';

describe('replay fixture sanitizer', () => {
    it('projects only evaluation fields and pseudonymizes correlated ids consistently', () => {
        const fixture = sanitizeReplaySession({
            sessionId: '507f1f77bcf86cd799439011',
            events: [{
                seq: 5,
                t: 154,
                at: new Date('2026-01-01T00:00:00Z'),
                type: TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT,
                meta: {
                    nodeId: 'customer-pricing',
                    directive: 'Call jane@example.com on +90 555 111 22 33',
                    url: 'https://secret.example/pricing?customer=jane',
                    topicId: 'topic:pricing',
                    claimIds: ['claim:pricing'],
                    semanticSource: 'semantic_resolver'
                }
            }, {
                seq: 6,
                t: 281,
                type: TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED,
                meta: {
                    proposedNodeIds: ['customer-pricing'],
                    semanticUnits: [{
                        nodeId: 'customer-pricing', topicId: 'topic:pricing',
                        claimIds: ['claim:pricing'], source: 'semantic_resolver'
                    }]
                }
            }, {
                seq: 7,
                type: TIMELINE_EVENTS.TRANSCRIPT_USER,
                meta: { text: 'My name is Jane' }
            }]
        }, { salt: SALT });

        const serialized = JSON.stringify(fixture);
        expect(fixture.fixtureId).toMatch(/^session:anon:[a-f0-9]{16}$/);
        expect(fixture.events).toHaveLength(2);
        expect(fixture.events[0]).toMatchObject({ seq: 1, t: 200 });
        expect(fixture.events[0].meta.nodeId)
            .toBe(fixture.events[1].meta.proposedNodeIds[0]);
        expect(fixture.events[0].meta.topicId)
            .toBe(fixture.events[1].meta.semanticUnits[0].topicId);
        expect(serialized).not.toContain('jane@example.com');
        expect(serialized).not.toContain('secret.example');
        expect(serialized).not.toContain('customer-pricing');
        expect(serialized).not.toContain('507f1f77bcf86cd799439011');
        expect(serialized).not.toContain('2026-01-01');
        expect(serialized).not.toContain('My name is Jane');
    });

    it('requires a non-trivial secret salt', () => {
        expect(() => sanitizeReplaySession({ sessionId: 'session', events: [] }, { salt: 'short' }))
            .toThrow(/at least 16/);
    });

    it('preserves semantic equality needed by the replay evaluator', () => {
        const fixture = sanitizeReplaySession({
            sessionId: 'session',
            events: [{
                seq: 1,
                type: TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT,
                meta: {
                    nodeId: 'reporting', topicId: 'topic:reporting',
                    claimIds: ['claim:reporting'], semanticSource: 'compiler_fallback'
                }
            }, {
                seq: 2,
                type: TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED,
                meta: {
                    proposedNodeIds: ['answer'],
                    semanticUnits: [{
                        nodeId: 'answer', topicId: 'topic:reporting',
                        claimIds: ['claim:reporting'], source: 'semantic_resolver'
                    }]
                }
            }]
        }, { salt: SALT });
        const report = evaluateDynamicPlaybookTimeline(fixture.events);

        expect(report.shadowComparison).toMatchObject({
            semanticComparisonAvailable: true,
            semanticComparisonTrusted: true,
            topics: { legacyCoverage: 1, dynamicPrecision: 1 }
        });
    });

    it('keeps survey lifecycle correlation while removing answers and free text', () => {
        const fixture = sanitizeReplaySession({
            sessionId: 'survey-session',
            events: [{
                seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG,
                meta: { enabled: true, cohort: 'canary', configuredFieldCount: 3,
                    note: 'jane@example.com' }
            }, {
                seq: 2, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
                meta: { event: 'opened', proposalId: 'private-proposal',
                    questionKey: 'company.industry', answerType: 'single_select',
                    question: 'Jane, which sector?', answer: 'healthcare',
                    expiresInMs: 30000 }
            }, {
                seq: 3, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
                meta: { event: 'answered', proposalId: 'private-proposal',
                    answerId: 'private-answer', answer: 'healthcare' }
            }]
        }, { salt: SALT });
        expect(fixture.events[0].meta).toEqual({
            enabled: true, reason: null, cohort: 'canary', configuredFieldCount: 3
        });
        expect(fixture.events[1].meta.proposalId).toBe(fixture.events[2].meta.proposalId);
        expect(fixture.events[1].meta.expiresInMs).toBe(30000);
        const serialized = JSON.stringify(fixture);
        for (const secret of ['jane@example.com', 'Jane', 'healthcare', 'private-proposal',
            'private-answer', 'company.industry']) {
            expect(serialized).not.toContain(secret);
        }
        expect(evaluateDynamicPlaybookTimeline(fixture.events).adaptiveSurveyLifecycle)
            .toMatchObject({ pilotEnabled: true, opened: 1, answered: 1, unclosed: 0 });
    });

    it('preserves only allowlisted reviewer status codes for pilot replay', () => {
        const fixture = sanitizeReplaySession({
            sessionId: 'survey-review-session',
            events: [{ seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION,
                meta: { status: 'rejected', reason: 'fact_already_known',
                    reviewStatuses: [
                        'known_fact:flagged', 'conversation_timing:passed',
                        'jane@example.com:flagged', 'model_critic:private-answer'
                    ] } }]
        }, { salt: SALT });
        expect(fixture.events[0].meta.reviewStatuses)
            .toEqual(['known_fact:flagged', 'conversation_timing:passed']);
        expect(JSON.stringify(fixture)).not.toMatch(/jane@example.com|private-answer/);
        expect(evaluateDynamicPlaybookTimeline(fixture.events).adaptiveSurveyPolicy)
            .toMatchObject({ reviewerStatuses: {
                'known_fact:flagged': 1, 'conversation_timing:passed': 1
            } });
    });

    it('exports shadow opportunity signals without the raw field key', () => {
        const fixture = sanitizeReplaySession({ sessionId: 'shadow-session', events: [{
            seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION,
            meta: { questionKey: 'company.industry', status: 'unknown_field_candidate',
                factStatus: 'unknown', turnIndex: 2, value: 'private-finance' }
        }] }, { salt: SALT });
        expect(JSON.stringify(fixture)).not.toMatch(/company.industry|private-finance/);
        expect(evaluateDynamicPlaybookTimeline(fixture.events).adaptiveSurveyShadow)
            .toMatchObject({ observations: 1, observedFieldCount: 1,
                statuses: { unknown_field_candidate: 1 } });
    });

    it('exports shadow proposal policy outcomes but never its question text', () => {
        const fixture = sanitizeReplaySession({ sessionId: 'shadow-proposal', events: [{
            seq: 1, type: TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL,
            meta: { proposalId: 'shadow_1_company.industry',
                questionKey: 'company.industry', status: 'approved',
                reason: 'policy_passed', turnIndex: 1,
                question: 'Private customer question', answer: 'secret answer' }
        }] }, { salt: SALT });
        expect(JSON.stringify(fixture)).not.toMatch(/company.industry|Private|secret answer/);
        expect(evaluateDynamicPlaybookTimeline(fixture.events).adaptiveSurveyShadow)
            .toMatchObject({ proposals: 1, proposalStatuses: { approved: 1 } });
    });

    it('exports multi-agent rollout and analyst outcomes without transcript or model identifiers', () => {
        const fixture = sanitizeReplaySession({ sessionId: 'multi-agent-session', events: [{
            seq: 1,
            type: TIMELINE_EVENTS.MULTI_AGENT_ROLLOUT_DECISION,
            meta: { mode: 'canary', cohort: 'canary', enabled: true,
                applyAcceptedState: true, participantMemoryEnabled: true, bucket: 3 }
        }, {
            seq: 2,
            type: TIMELINE_EVENTS.MULTI_AGENT_ANALYST_RUN,
            meta: { analystId: 'participant_memory', status: 'accepted',
                proposalType: 'participant_memory', durationMs: 210,
                model: 'private-model-name', transcript: 'Jane jane@example.com' }
        }] }, { salt: SALT });
        expect(fixture.events[0].meta).toMatchObject({
            cohort: 'canary', enabled: true, applyAcceptedState: true
        });
        expect(fixture.events[1].meta).toMatchObject({
            analystId: 'participant_memory', status: 'accepted', durationMs: 210
        });
        expect(JSON.stringify(fixture)).not.toMatch(/Jane|jane@example.com|private-model-name/);
    });
});
