import { foldSnapshotText } from './chrome-snapshot.js';

const DESTRUCTIVE_TERMS = [
    'delete', 'remove', 'destroy', 'logout', 'log out', 'sign out', 'purchase', 'buy now',
    'place order', 'pay now', 'submit payment', 'save changes', 'submit', 'confirm order',
    'sil', 'kaldir', 'cikis yap', 'satın al', 'odeme yap', 'siparisi ver', 'hesabi kapat',
    'kaydet', 'gonder', 'onayla'
];

/** Domain-independent safety policy for model-initiated browser actions. */
export class BrowserActionPolicy {
    constructor({ destructiveTerms = DESTRUCTIVE_TERMS } = {}) {
        this.destructiveTerms = destructiveTerms.map(foldSnapshotText);
    }

    assertAllowed({ action, element, capability = 'agent' }) {
        if (capability.startsWith('system:')) return { allowed: true, classification: capability };
        if (action !== 'click') return { allowed: true, classification: 'non_click' };
        if (!element) throw new Error('[BrowserActionPolicy] Cannot authorize a click without a live element descriptor.');

        const text = foldSnapshotText(`${element.role} ${element.name} ${element.line}`);
        const matchedTerm = this.destructiveTerms.find((term) => text.includes(term));
        if (matchedTerm) {
            throw new Error(`[BrowserActionPolicy] Blocked potentially destructive click on "${element.name || element.role}".`);
        }
        return { allowed: true, classification: 'presentation_safe' };
    }
}

export { DESTRUCTIVE_TERMS };
