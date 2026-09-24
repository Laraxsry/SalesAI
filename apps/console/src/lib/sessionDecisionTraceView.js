export function routeDiff(revision, revisions) {
    const base = revisions.find((item) => item.revision === revision.baseRevision);
    const baseIds = new Set(base?.nodes.map((node) => node.id) || []);
    const currentIds = new Set(revision.nodes.map((node) => node.id));
    return {
        added: revision.nodes.filter((node) => !baseIds.has(node.id)).map((node) => node.id),
        retained: revision.nodes.filter((node) => baseIds.has(node.id)).map((node) => node.id),
        removed: (base?.nodes || []).filter((node) => !currentIds.has(node.id)).map((node) => node.id)
    };
}
