const PREFIX = 'salesai.console.selection';

function read(key) {
    try {
        return window.localStorage.getItem(`${PREFIX}.${key}`) || '';
    } catch {
        return '';
    }
}

function write(key, value) {
    try {
        if (value) window.localStorage.setItem(`${PREFIX}.${key}`, value);
    } catch {
        // Storage can be unavailable in private/restricted browser contexts.
    }
}

export function productSelectionKey(workspaceId) {
    return `workspace.${workspaceId}.product`;
}

export function agentSelectionKey(workspaceId, productId) {
    return `workspace.${workspaceId}.product.${productId}.agent`;
}

/** URL wins when valid, then remembered selection, then the first available item. */
export function resolveRememberedSelection({ currentId, items, storageKey, getId = (item) => item.id }) {
    if (!items?.length || !storageKey) return '';
    const ids = new Set(items.map((item) => String(getId(item))));
    const current = currentId ? String(currentId) : '';
    if (ids.has(current)) {
        write(storageKey, current);
        return current;
    }
    const remembered = read(storageKey);
    if (ids.has(remembered)) return remembered;
    const fallback = String(getId(items[0]));
    write(storageKey, fallback);
    return fallback;
}

export function rememberSelection(storageKey, value) {
    if (storageKey) write(storageKey, String(value || ''));
}
