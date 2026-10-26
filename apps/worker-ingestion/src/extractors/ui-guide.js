/**
 * What the crawl learned about a logged-in dashboard page, written down.
 *
 * `describeState` turns one observed press ("pressing X opened a panel asking for Y") into a sentence;
 * `annotateElements` writes that sentence on the element it belongs to (`expected`), so the element
 * record says what pressing it does; `renderPageGuide` assembles a page's findings into text that can be
 * embedded, so a retrieval can answer "what happens when I press ..." from a crawl alone.
 *
 * Deterministic: no model involved. A model can add a plainer "what is this for" (`purpose`) on top.
 */

const pathOf = (url) => {
    try {
        return new URL(url).pathname.replace(/[0-9a-f]{24}/gi, ':id');
    } catch {
        return url;
    }
};

const fieldList = (fields) =>
    fields.map((field) => `${field.label || '(no label)'} (${field.type}${field.required ? ', required' : ''})`).join('; ');

const labelList = (items, max = 8) => items.slice(0, max).map((item) => item.label).join(', ');

/** @param {object} state one entry of `components.states` (see state-discovery.js) */
export function describeState(state) {
    const fields = state.form?.fields || [];
    const buttons = (state.form?.actions || []).map((action) => action.label).filter(Boolean);
    const form = fields.length
        ? ` with a form asking for: ${fieldList(fields)}${buttons.length ? `; buttons: ${buttons.join(', ')}` : ''}`
        : '';

    switch (state.kind) {
        case 'dialog':
            return `Opens a dialog${state.title ? ` "${state.title}"` : ''}${form || (state.newElements?.length ? ` with: ${labelList(state.newElements)}` : '')}.`;
        case 'menu':
            return `Opens a menu with: ${labelList(state.newElements || [])}.`;
        case 'navigation':
            return `Goes to another page (${pathOf(state.targetUrl)}).`;
        case 'write':
            return 'Sends data to the server without changing what is shown.';
        default:
            return form ? `Opens a panel${form}.` : `Shows more on the page: ${labelList(state.newElements || [], 6) || 'new content'}.`;
    }
}

/** Writes `expected` on every interactive element that has an observed state. Mutates and returns `components`. */
export function annotateElements(components) {
    if (!components?.states?.length) return components;
    for (const state of components.states) {
        const element = (components.interactiveElements || []).find((item) => item.label === state.trigger);
        if (element && !element.expected) element.expected = describeState(state);
    }
    return components;
}

/** The page's findings as embeddable text, or '' when the crawl pressed nothing that did anything. */
export function renderPageGuide({ url, components }) {
    const states = components?.states || [];
    if (!states.length) return '';
    const elements = components.interactiveElements || [];
    const lines = [`On the page ${pathOf(url)}:`];
    for (const state of states) {
        const purpose = elements.find((item) => item.label === state.trigger)?.purpose;
        lines.push(`- Pressing "${state.trigger}"${purpose ? ` (${purpose.replace(/\.$/, '')})` : ''}: ${describeState(state)}`);
    }
    return lines.join('\n');
}
