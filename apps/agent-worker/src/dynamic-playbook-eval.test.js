import { describe, expect, it } from 'vitest';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { evaluateDynamicPlaybookTimeline } from './dynamic-playbook-eval.js';
import {
    aggregateDynamicPlaybookReports,
    evaluateDynamicPlaybookRolloutReadiness
} from './dynamic-playbook-rollout-readiness.js';

function event(type, seq, meta = {}, durationMs) {
    return { type, seq, meta, ...(durationMs === undefined ? {} : { durationMs }) };
}

describe('dynamic playbook replay evaluation', () => {
    it('replays route, demo, obligation, and legacy shadow signals', () => {
        const report = evaluateDynamicPlaybookTimeline([
            event(TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT, 1, {
                nodeId: 'legacy-1',
                topicId: 'topic:catalog:reporting',
                claimIds: ['claim:catalog:auto-reporting'],
                semanticSource: 'semantic_resolver'
            }),
            event(TIMELINE_EVENTS.ROUTE_PLANNING_STARTED, 2),
            event(TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED, 3, {
                proposedNodeIds: ['answer-1', 'demo-1'],
                semanticUnits: [{
                    nodeId: 'answer-1',
                    topicId: 'topic:catalog:reporting',
                    claimIds: ['claim:catalog:auto-reporting'],
                    source: 'semantic_resolver'
                }, {
                    nodeId: 'demo-1',
                    topicId: 'topic:knowledge:custom-question',
                    claimIds: ['claim:evidence:custom-answer'],
                    source: 'knowledge_intent'
                }]
            }, 120),
            event(TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION, 4, {
                event: 'result', status: 'completed'
            }),
            event(TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_STATE_TRANSITION, 5, {
                eventType: 'OBLIGATION_STATUS_CHANGED', obligationStatus: 'satisfied'
            }),
            event(TIMELINE_EVENTS.KNOWLEDGE_RESOLVED, 6),
            event(TIMELINE_EVENTS.MEMORY_PROMOTION_DECISION, 7, {
                allowed: false, reason: 'demo_budget_exhausted', enforced: false
            }),
            event(TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION, 8, {
                status: 'deferred', reason: 'answer_first_required', channel: null
            })
        ]);

        expect(report.planning).toMatchObject({
            accepted: 1, decisions: 1, acceptanceRate: 1,
            latencyMs: { samples: 1, average: 120, p95: 120 }
        });
        expect(report.demo).toMatchObject({ attempts: 1, completed: 1, failureRate: 0 });
        expect(report.obligations.transitions).toEqual({ satisfied: 1 });
        expect(report.memoryPolicy).toEqual({
            decisions: 1,
            allowed: 0,
            blocked: 1,
            enforcedBlocks: 0,
            shadowBlocks: 1,
            blockReasons: { demo_budget_exhausted: 1 }
        });
        expect(report.adaptiveSurveyPolicy).toEqual({
            decisions: 1,
            statuses: { deferred: 1 },
            reasons: { answer_first_required: 1 },
            channels: { none: 1 },
            reviewerStatuses: {}
        });
        expect(report.shadowComparison).toMatchObject({
            legacyCompletedNodeCount: 1,
            dynamicAcceptedRouteCount: 1,
            dynamicProposedNodeCount: 2,
            comparisonAvailable: true,
            semanticComparisonAvailable: true,
            semanticComparisonTrusted: true,
            semanticSources: {
                legacy: ['semantic_resolver'],
                dynamic: ['knowledge_intent', 'semantic_resolver']
            },
            topics: {
                matched: ['topic:catalog:reporting'],
                legacyOnly: [],
                dynamicOnly: ['topic:knowledge:custom-question'],
                legacyCoverage: 1,
                dynamicPrecision: 0.5,
                jaccard: 0.5
            },
            claims: {
                matched: ['claim:catalog:auto-reporting'],
                legacyOnly: [],
                dynamicOnly: ['claim:evidence:custom-answer']
            },
            trustedTopics: {
                matched: ['topic:catalog:reporting'],
                legacyOnly: [],
                dynamicOnly: []
            }
        });
        const aggregate = aggregateDynamicPlaybookReports([report]);
        expect(aggregate.semanticEvidence).toEqual({
            comparableSessions: 1,
            trustedSessions: 1,
            trustedSessionRate: 1,
            topics: {
                legacy: 1, dynamic: 2, matched: 1,
                legacyCoverage: 1, dynamicPrecision: 0.5
            },
            claims: {
                legacy: 1, dynamic: 2, matched: 1,
                legacyCoverage: 1, dynamicPrecision: 0.5
            }
        });
    });

    it('distinguishes stale planning and customer cancellation from execution failure', () => {
        const report = evaluateDynamicPlaybookTimeline([
            event(TIMELINE_EVENTS.ROUTE_PROPOSAL_IGNORED, 1, {
                reason: 'superseded_planning_generation'
            }, 40),
            event(TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION, 2, {
                event: 'result', status: 'cancelled'
            }),
            event(TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION, 3, {
                event: 'result', status: 'failed'
            })
        ]);
        expect(report.planning).toMatchObject({ decisions: 1, stale: 1, staleRate: 1 });
        expect(report.demo).toMatchObject({ attempts: 2, cancelled: 1, failed: 1, failureRate: 0.5 });
    });

    it('keeps legacy retirement blocked even when replay thresholds pass', () => {
        const report = evaluateDynamicPlaybookTimeline([
            event(TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED, 1, {}, 10),
            event(TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION, 2, {
                event: 'result', status: 'completed'
            })
        ]);
        const aggregate = aggregateDynamicPlaybookReports(Array.from({ length: 50 }, () => report));
        const readiness = evaluateDynamicPlaybookRolloutReadiness(aggregate);
        expect(readiness.ready).toBe(true);
        expect(readiness.legacyRetirementAllowed).toBe(false);
        expect(readiness.blockers).toEqual([]);
    });

    it('fails closed when there is not enough replay evidence', () => {
        const readiness = evaluateDynamicPlaybookRolloutReadiness(
            aggregateDynamicPlaybookReports([])
        );
        expect(readiness.ready).toBe(false);
        expect(readiness.blockers).toContain('minimum_sessions');
        expect(readiness.blockers).toContain('demo_failure_rate');
    });
});
