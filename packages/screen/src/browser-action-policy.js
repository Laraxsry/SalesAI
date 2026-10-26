import { foldSnapshotText } from './chrome-snapshot.js';

const DESTRUCTIVE_TERMS = [
    'delete', 'remove', 'destroy', 'logout', 'log out', 'sign out', 'purchase', 'buy now',
    'place order', 'pay now', 'submit payment', 'save changes', 'submit', 'confirm order',
    'sil', 'kaldir', 'cikis yap', 'satın al', 'odeme yap', 'siparisi ver', 'hesabi kapat',
    'kaydet', 'gonder', 'onayla'
];
const FORM_SUBMIT_TERMS = /^(add|create|save|update|ekle|olustur|kaydet|guncelle)$/iu;
// Labels that remove data. Even inside a procedure they only work on something the demo itself made.
const REMOVAL_LABELS = new Set(['delete', 'remove', 'destroy', 'sil', 'kaldir']);
const DEFAULT_OWNED_MARKERS = ['salesai-demo-', 'salesai_demo_', 'salesaidemo'];

/** Domain-independent safety policy for model-initiated browser actions. */
export class BrowserActionPolicy {
    constructor({ destructiveTerms = DESTRUCTIVE_TERMS } = {}) {
        this.destructiveTerms = destructiveTerms.map(foldSnapshotText);
        this.procedure = null;
    }

    /**
     * Open a narrow door for one learned procedure (e.g. "add a variable, then remove it").
     * While it is active, a click whose label is exactly one of the recipe's labels may pass the usual
     * save/submit/delete rules. Removal labels additionally need "arming": a recent click on an element in a
     * row that carries one of the demo's own markers. Anything not named by the recipe stays blocked.
     */
    beginProcedure({ id, labels = [], ownedMarkers = DEFAULT_OWNED_MARKERS, maxArmedClicks = 3 } = {}) {
        this.procedure = {
            id,
            labels: new Set(labels.map(foldSnapshotText).filter(Boolean)),
            markers: ownedMarkers.map(foldSnapshotText).filter(Boolean),
            maxArmedClicks,
            armed: 0
        };
    }

    endProcedure() {
        this.procedure = null;
    }

    _authorizeWithinProcedure(element) {
        const procedure = this.procedure;
        const label = foldSnapshotText(element.name || '');
        if (!procedure || !label || !procedure.labels.has(label)) return null;

        const ownsRow = procedure.markers.some((marker) => (element.rowText || '').includes(marker));
        if (REMOVAL_LABELS.has(label)) {
            if (!ownsRow && procedure.armed <= 0) {
                throw new Error(`[BrowserActionPolicy] Blocked "${element.name}": nothing the demo created is selected.`);
            }
            if (!ownsRow) procedure.armed -= 1;
            return { allowed: true, classification: 'procedure_removal' };
        }
        if (ownsRow) procedure.armed = procedure.maxArmedClicks;
        else if (procedure.armed > 0) procedure.armed -= 1;
        return { allowed: true, classification: 'procedure_step' };
    }

    // Presentation-safe clicks inside a procedure also keep the arming alive when they touch an owned row.
    _noteSafeClick(element) {
        const procedure = this.procedure;
        if (!procedure) return;
        if (procedure.markers.some((marker) => (element.rowText || '').includes(marker))) procedure.armed = procedure.maxArmedClicks;
        else if (procedure.armed > 0) procedure.armed -= 1;
    }

    assertAllowed({ action, element, capability = 'agent' }) {
        if (capability.startsWith('system:')) return { allowed: true, classification: capability };
        if (action !== 'click') return { allowed: true, classification: 'non_click' };
        if (!element) throw new Error('[BrowserActionPolicy] Cannot authorize a click without a live element descriptor.');

        const inProcedure = this._authorizeWithinProcedure(element);
        if (inProcedure) return inProcedure;

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
        this._noteSafeClick(element);
        return { allowed: true, classification: 'presentation_safe' };
    }
}

export { DESTRUCTIVE_TERMS };
