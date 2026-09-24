import { describe, expect, it } from 'vitest';
import { resolveRouteSemanticIdentity } from './route-semantic-resolver.js';

function context(nodes, pageUrl = 'https://example.test/reports/') {
    return {
        currentRoute: nodes,
        knowledge: {
            evidence: [{ page: { url: pageUrl } }]
        },
        allowedDemoTargets: [{ pageUrl }]
    };
}

function node(id, topicId, url = 'https://example.test/reports') {
    return {
        id,
        pageIntent: { preferredUrl: url },
        semanticIdentity: {
            topicId,
            claimIds: [`claim:legacy:${id}`],
            source: 'compiler_fallback'
        }
    };
}

describe('route semantic resolver', () => {
    it('bridges a grounded page to one unambiguous legacy topic', () => {
        const identity = resolveRouteSemanticIdentity({
            context: context([node('reporting', 'topic:legacy:reporting')]),
            intentId: 'knowledge:abcd',
            evidenceRefs: ['knowledge:chunk-1']
        });

        expect(identity).toEqual({
            topicId: 'topic:legacy:reporting',
            claimIds: ['claim:legacy:reporting', 'claim:evidence:knowledge:chunk-1'],
            source: 'semantic_resolver'
        });
    });

    it('fails back when one page represents multiple canonical topics', () => {
        const identity = resolveRouteSemanticIdentity({
            context: context([
                node('reporting', 'topic:legacy:reporting'),
                node('exports', 'topic:legacy:exports')
            ]),
            intentId: 'knowledge:abcd',
            evidenceRefs: ['knowledge:chunk-1']
        });

        expect(identity).toMatchObject({
            topicId: 'topic:knowledge:knowledge:abcd',
            source: 'knowledge_intent'
        });
    });

    it('fails back when evidence has no playbook page match', () => {
        const identity = resolveRouteSemanticIdentity({
            context: context([node('reporting', 'topic:legacy:reporting')], 'https://example.test/other'),
            intentId: 'knowledge:abcd'
        });

        expect(identity.source).toBe('knowledge_intent');
    });
});
