import { describe, expect, it } from 'vitest';
import {
    CapabilityRequestInput,
    CompiledPlaybookContractInput,
    DynamicPlaybookNodeInput,
    KnowledgeResolutionResultInput,
    RoutePlanningContextInput,
    RouteProposalInput,
    RouteRevisionInput,
    compileLegacyPlaybook,
    semanticIdentityForKnowledgeIntent
} from './dynamic-playbook.js';

describe('dynamic playbook contracts', () => {
    it('accepts a grounded demo node', () => {
        const node = DynamicPlaybookNodeInput.parse({
            id: 'demo_pdf_import',
            type: 'demo',
            objective: 'Ekstre yükleme alanını göster',
            requirement: 'preferred',
            evidenceRefs: ['knowledge:pdf-import', 'page:/import'],
            pageIntent: {
                purpose: 'statement_import',
                preferredUrl: 'https://example.test/import'
            },
            actions: [{ intent: 'focus', target: 'Ekstre Yükle' }]
        });

        expect(node.createdBy).toBe('initial_contract');
        expect(node.maxAttempts).toBe(1);
    });

    it('creates one canonical topic with evidence-backed claim ids per knowledge intent', () => {
        const first = semanticIdentityForKnowledgeIntent('knowledge:ABCD', [
            'knowledge:chunk-1', 'knowledge:chunk-1'
        ]);
        const second = semanticIdentityForKnowledgeIntent('knowledge:ABCD', ['knowledge:chunk-2']);

        expect(first.topicId).toBe(second.topicId);
        expect(first.claimIds).toEqual(['claim:evidence:knowledge:chunk-1']);
        expect(first.source).toBe('knowledge_intent');
    });

    it('rejects duplicate route node ids', () => {
        const node = {
            id: 'same',
            type: 'answer',
            objective: 'Yanıtla'
        };
        expect(RouteRevisionInput.safeParse({
            revision: 1,
            baseRevision: 0,
            reason: 'test',
            nodes: [node, node]
        }).success).toBe(false);
    });

    it('requires every obligation to reference a route node', () => {
        const result = CompiledPlaybookContractInput.safeParse({
            id: 'contract',
            nodes: [{ id: 'answer', type: 'answer', objective: 'Yanıtla' }],
            obligations: [{
                id: 'missing',
                objective: 'Kapanışı tamamla',
                requirement: 'required_before_close',
                completionCriteria: ['contact_requested']
            }]
        });
        expect(result.success).toBe(false);
    });
});

describe('knowledge resolution contracts', () => {
    it('keeps an empty lookup as a candidate rather than a confirmed gap', () => {
        const result = KnowledgeResolutionResultInput.parse({
            intentId: 'knowledge:1',
            query: 'Bilinmeyen özellik',
            status: 'not_found',
            evidence: [],
            demoTargets: [],
            knowledgeGap: { status: 'candidate', reason: 'no_grounding_evidence' }
        });

        expect(result.knowledgeGap.status).toBe('candidate');
    });

    it('rejects a claimed demo resolution without a demo target', () => {
        const result = KnowledgeResolutionResultInput.safeParse({
            intentId: 'knowledge:1',
            query: 'PDF',
            status: 'grounded_with_demo',
            evidence: [{
                evidenceId: 'knowledge:c1',
                kind: 'knowledge',
                text: 'PDF desteklenir',
                score: 0.9,
                sourceId: 'source:1'
            }],
            demoTargets: [],
            knowledgeGap: { status: 'none', reason: null }
        });

        expect(result.success).toBe(false);
    });

    it('requires explicit consent for a capability request', () => {
        const base = {
            requestedOutcome: 'API ile ekstre çekmek',
            evidenceStatus: 'not_found'
        };
        expect(CapabilityRequestInput.safeParse({ ...base, consentToContact: false }).success).toBe(false);
        expect(CapabilityRequestInput.safeParse({ ...base, consentToContact: true }).success).toBe(true);
    });
});

describe('route planning contracts', () => {
    it('defaults planner actions to unclassified safety', () => {
        const proposal = RouteProposalInput.parse({
            baseRevision: 0,
            planningGeneration: 1,
            reason: 'customer_question',
            proposedNodes: [{
                id: 'demo',
                type: 'demo',
                objective: 'Alanı göster',
                actions: [{ intent: 'click', target: 'Aç' }]
            }]
        });

        expect(proposal.proposedNodes[0].actions[0].safety).toBe('unclassified');
    });

    it('requires a positive planning generation in context', () => {
        const result = RoutePlanningContextInput.safeParse({
            sessionId: 'session',
            contractId: 'contract',
            routeRevision: 0,
            planningGeneration: 0,
            reason: 'test',
            currentRoute: []
        });

        expect(result.success).toBe(false);
    });
});

describe('compileLegacyPlaybook', () => {
    const legacyNodes = [
        {
            id: 'intro', order: 1, type: 'narrative', directive: 'Şirketi tanıt',
            url: null, actions: [], mode: 'important', survey: null
        },
        {
            id: 'demo', order: 2, type: 'narrative', directive: 'Raporu göster',
            url: 'https://example.test/reports', actions: ['Raporlara tıkla'],
            mode: 'situational', survey: null
        },
        {
            id: 'close', order: 3, type: 'narrative', directive: 'Uygun günü sor',
            url: null, actions: [], mode: 'important', survey: null
        }
    ];

    it('does not silently turn legacy important nodes into obligations', () => {
        const contract = compileLegacyPlaybook(legacyNodes, { contractId: 'agent:1' });
        expect(contract.obligations).toEqual([]);
        expect(contract.nodes.find((node) => node.id === 'intro').requirement).toBe('preferred');
    });

    it('creates only explicitly selected closing obligations', () => {
        const contract = compileLegacyPlaybook(legacyNodes, {
            contractId: 'agent:1',
            sourceVersion: 7,
            requiredBeforeCloseNodeIds: ['close']
        });

        expect(contract.sourceVersion).toBe(7);
        expect(contract.obligations).toHaveLength(1);
        expect(contract.obligations[0]).toMatchObject({
            id: 'close',
            requirement: 'required_before_close'
        });
        expect(contract.nodes.find((node) => node.id === 'demo')).toMatchObject({
            type: 'demo',
            semanticIdentity: {
                topicId: 'topic:legacy:demo',
                claimIds: ['claim:legacy:demo'],
                source: 'compiler_fallback'
            },
            actions: [{ intent: 'resolve', target: 'Raporlara tıkla' }]
        });
    });

    it('accepts a replaceable semantic resolver without changing compiler authority', () => {
        const contract = compileLegacyPlaybook(legacyNodes, {
            contractId: 'agent:semantic',
            resolveSemantics: (node) => ({
                topicId: `topic:catalog:${node.id}`,
                claimIds: [`claim:catalog:${node.id}`],
                source: 'semantic_resolver'
            })
        });

        expect(contract.nodes.map((node) => node.semanticIdentity.source))
            .toEqual(['semantic_resolver', 'semantic_resolver', 'semantic_resolver']);
    });

    it('can preserve an explicitly required legacy survey as an ask obligation', () => {
        const surveyNode = {
            id: 'contact_method',
            order: 1,
            type: 'survey',
            directive: 'Tercih edilen iletişim kanalını sor',
            url: null,
            actions: [],
            mode: 'important',
            survey: {
                question: 'Size nasıl ulaşalım?',
                fieldKey: 'contact.method',
                answerType: 'single-choice',
                options: [
                    { value: 'phone', label: 'Telefon' },
                    { value: 'email', label: 'E-posta' }
                ],
                allowFreeText: false,
                required: true
            }
        };

        const compiled = compileLegacyPlaybook([surveyNode], {
            contractId: 'agent:survey',
            requiredBeforeCloseNodeIds: ['contact_method']
        });

        expect(compiled.nodes[0]).toMatchObject({
            id: 'contact_method',
            type: 'ask',
            requirement: 'required_before_close'
        });
        expect(compiled.obligations).toHaveLength(1);
    });
});
