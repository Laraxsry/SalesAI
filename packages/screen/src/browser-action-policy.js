import { foldSnapshotText } from './chrome-snapshot.js';

const DESTRUCTIVE_TERMS = [
    'delete', 'remove', 'destroy', 'logout', 'log out', 'sign out', 'purchase', 'buy now',
    'place order', 'pay now', 'submit payment', 'save changes', 'submit', 'confirm order',
    'sil', 'kaldir', 'cikis yap', 'satın al', 'odeme yap', 'siparisi ver', 'hesabi kapat',
    'kaydet', 'gonder', 'onayla'
];
const FORM_SUBMIT_TERMS = /^(add|create|save|update|ekle|olustur|kaydet|guncelle)$/iu;

/** Domain-independent safety policy for model-initiated browser actions. */
export class BrowserActionPolicy {
    constructor({ destructiveTerms = DESTRUCTIVE_TERMS } = {}) {
        this.destructiveTerms = destructiveTerms.map(foldSnapshotText);
    }

    assertAllowed({ action, element, capability = 'agent' }) {
        if (capability.startsWith('system:')) return { allowed: true, classification: capability };
        if (action !== 'click') return { allowed: true, classification: 'non_click' };
        if (!element) throw new Error('[BrowserActionPolicy] Cannot authorize a click without a live element descriptor.');

        // "Add" may be harmless navigation outside a form, but the same
        // label inside a form commits data. Filling a demo is not consent to
        // create a real record in the customer's product.
        if (element.insideForm && FORM_SUBMIT_TERMS.test(foldSnapshotText(element.name))) {
            throw new Error(`[BrowserActionPolicy] Blocked potentially persistent form submit on "${element.name}".`);
        }

        const text = foldSnapshotText(`${element.role} ${element.name} ${element.line}`);
        const matchedTerm = this.destructiveTerms.find((term) => text.includes(term));
        if (matchedTerm) {
            throw new Error(`[BrowserActionPolicy] Blocked potentially destructive click on "${element.name || element.role}".`);
        }
        return { allowed: true, classification: 'presentation_safe' };
    }
}

export { DESTRUCTIVE_TERMS };
