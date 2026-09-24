import { DynamicPlaybookNodeInput } from '@repo/contracts';

/** Boundary from validated dynamic route nodes to the existing speech runtime. */
export function projectDynamicRouteForPresentation(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new TypeError('a non-empty accepted route is required');
    }
    const seen = new Set();
    return nodes.map((rawNode, index) => {
        const node = DynamicPlaybookNodeInput.parse(rawNode);
        if (seen.has(node.id)) throw new TypeError('duplicate dynamic route node');
        seen.add(node.id);
        return {
            id: node.id,
            order: index + 1,
            type: 'narrative',
            directive: node.objective,
            url: node.type === 'demo' ? node.pageIntent?.preferredUrl ?? null : null,
            actions: [],
            mode: node.requirement === 'required_before_close' ? 'important' : 'situational',
            dynamicNode: node
        };
    });
}
