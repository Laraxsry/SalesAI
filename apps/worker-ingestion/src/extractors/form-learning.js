/**
 * Forms: reading what a form asks for, and what to type into it.
 *
 * `extractOverlayForm` reads the fields of the dialog that is open right now
 * (label, type, whether it is required, the choices of a select or radio group).
 * Reading is harmless, so the crawler does it for every dialog a button press
 * opens (see state-discovery.js) and every form is on record without anyone
 * submitting anything.
 *
 * `demoValueFor` picks a value to type into a field when we do learn a form by
 * filling it in on the demo account: ordinary-looking, clearly ours (the
 * `LEARNING_PREFIX`, so what we create can be found and cleaned up), and never
 * a made-up credential. The value source is injectable: a later provider can
 * ask an LLM for more natural values without touching the callers.
 */

/** Everything the learning run creates carries this, so it can be recognised and removed. */
export const LEARNING_PREFIX = 'salesai-demo-';

// A field about secrets or payment is left alone: inventing a value for it is wrong and can lock an account.
const SENSITIVE = /password|passcode|şifre|sifre|secret|token|api[\s_-]?key|private[\s_-]?key|card|cvv|cvc|iban|ssn|otp|2fa/i;
const PLACEHOLDER_OPTION = /^(?:select|choose|seç|seçiniz|pick|please|-+|—+)/i;

const slug = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);

const FORM_CONTROLS = 'input, select, textarea, [role="combobox"], [role="switch"]';

/**
 * Runs INSIDE the page. Marks every form control that is on screen right now, so that after
 * something is opened the controls it ADDED can be told from the ones that were already there.
 */
export function markExistingInputs(config) {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const keyOf = (el) =>
        `${el.getAttribute('role') || el.tagName.toLowerCase()}|${clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id)}`;
    for (const old of document.querySelectorAll(`[${config.seenAttribute}]`)) old.removeAttribute(config.seenAttribute);
    for (const rootOld of document.querySelectorAll(`[${config.formRootAttribute}]`)) rootOld.removeAttribute(config.formRootAttribute);
    // Remembered by label as well as by element: an app that re-renders part of the page when a panel opens
    // creates NEW elements for controls that were already there, and those must not count as new.
    const seenKeys = [];
    for (const el of document.querySelectorAll(config.formControls)) {
        if (!visible(el)) continue;
        el.setAttribute(config.seenAttribute, '1');
        seenKeys.push(keyOf(el));
    }
    window.__salesaiSeenKeys = seenKeys;
}

/**
 * Runs INSIDE the page. After `markExistingInputs` and a press: finds the controls that appeared,
 * and tags the container that holds them together with their buttons (a side panel, a drawer, an
 * inline form) so it can be read like a dialog. Returns whether such a container was found.
 */
export function tagNewFormRoot(config) {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const keyOf = (el) =>
        `${el.getAttribute('role') || el.tagName.toLowerCase()}|${clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id)}`;
    const hiddenTypes = ['hidden', 'submit', 'button', 'reset', 'image'];
    const seenKeys = new Set(window.__salesaiSeenKeys || []);
    // New = not the same element AND not a control with the same label that was already on screen.
    const fresh = [...document.querySelectorAll(config.formControls)].filter(
        (el) =>
            visible(el) &&
            !el.hasAttribute(config.seenAttribute) &&
            !seenKeys.has(keyOf(el)) &&
            !hiddenTypes.includes((el.getAttribute('type') || '').toLowerCase())
    );
    if (!fresh.length) return false;

    const hasSeen = (el) => Boolean(el.querySelector(`[${config.seenAttribute}]`));
    const commitOrCancel = new RegExp(config.commitOrCancelLabels, 'i');
    const hasActionButton = (el) =>
        [...el.querySelectorAll('button, [role="button"], input[type="submit"]')].some((b) =>
            commitOrCancel.test((b.getAttribute('aria-label') || b.textContent || b.value || '').trim())
        );

    // Smallest ancestor that holds every new control…
    let root = fresh[0];
    while (root && !fresh.every((el) => root.contains(el))) root = root.parentElement;
    // …widened until it also holds the form's buttons, but never into the page that was already there.
    while (root && root.parentElement && !hasActionButton(root) && root.parentElement !== document.body && !hasSeen(root.parentElement)) {
        root = root.parentElement;
    }
    if (!root || root === document.body) return false;
    root.setAttribute(config.formRootAttribute, '1');
    return true;
}

/**
 * Runs INSIDE the page (via `page.evaluate`): self-contained, no imports.
 * Reads the form that is open: the panel tagged by `tagNewFormRoot`, else the topmost dialog.
 * Also tags the fields and buttons it reads (`config.fieldAttribute` / `actionAttribute`, by index)
 * so a learning run can find them again to fill and press.
 * @returns {{ fields:{label:string,type:string,required:boolean,placeholder?:string,options?:string[]}[], actions:{label:string,kind:string}[] } | null}
 */
export function extractOverlayForm(config) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

    // A panel/drawer tagged by tagNewFormRoot wins; otherwise the topmost dialog or menu.
    const surfaces = [...document.querySelectorAll(config.overlays.join(', '))].filter(visible);
    const tagged = document.querySelector(`[${config.formRootAttribute}]`);
    const root = (tagged && visible(tagged) ? tagged : null) || surfaces[surfaces.length - 1];
    if (!root) return null;
    for (const stale of document.querySelectorAll(`[${config.fieldAttribute}], [${config.actionAttribute}]`)) {
        stale.removeAttribute(config.fieldAttribute);
        stale.removeAttribute(config.actionAttribute);
    }

    const textWithoutControls = (el) => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('input, select, textarea, button').forEach((node) => node.remove());
        return clean(copy.textContent);
    };
    const labelOf = (el) => {
        const aria = el.getAttribute('aria-label');
        if (aria) return clean(aria);
        if (el.id) {
            const forLabel = root.querySelector(`label[for="${(globalThis.CSS?.escape ? CSS.escape(el.id) : el.id)}"]`);
            if (forLabel) return textWithoutControls(forLabel);
        }
        const wrapping = el.closest('label');
        if (wrapping) {
            const text = textWithoutControls(wrapping);
            if (text) return text;
        }
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
            const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
            if (clean(text)) return clean(text);
        }
        return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
    };

    const fields = [];
    const seenRadioGroups = new Set();
    const controls = root.querySelectorAll('input, select, textarea, [role="combobox"], [role="switch"]');
    for (const el of controls) {
        if (!visible(el)) continue;
        const tag = el.tagName.toLowerCase();
        const inputType = (el.getAttribute('type') || 'text').toLowerCase();
        if (tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(inputType)) continue;

        let type = tag === 'input' ? inputType : tag;
        if (el.getAttribute('role') === 'combobox') type = 'combobox';
        if (el.getAttribute('role') === 'switch') type = 'switch';

        let label = labelOf(el);
        let options;
        if (type === 'radio') {
            const group = el.getAttribute('name') || label;
            if (seenRadioGroups.has(group)) continue;
            seenRadioGroups.add(group);
            const members = [...root.querySelectorAll('input[type="radio"]')].filter((radio) => (radio.getAttribute('name') || labelOf(radio)) === group);
            options = members.map((radio) => labelOf(radio)).filter(Boolean).slice(0, 20);
            label = clean(el.closest('fieldset')?.querySelector('legend')?.textContent) || group;
        } else if (tag === 'select') {
            options = [...el.options].map((option) => clean(option.textContent)).filter(Boolean).slice(0, 20);
        }

        const required = el.required === true || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label);
        const placeholder = clean(el.getAttribute('placeholder'));
        // The learning run fills the field it finds at this index.
        el.setAttribute(config.fieldAttribute, String(fields.length));
        fields.push({
            label: label.replace(/\s*\*\s*$/, ''),
            type,
            required,
            ...(placeholder && { placeholder }),
            ...(options?.length && { options })
        });
    }

    const actions = [];
    for (const el of root.querySelectorAll('button, [role="button"], input[type="submit"]')) {
        if (!visible(el)) continue;
        const label = clean(el.getAttribute('aria-label') || el.textContent || el.value);
        if (!label) continue;
        el.setAttribute(config.actionAttribute, String(actions.length));
        actions.push({ label, kind: el.matches('[type="submit"]') ? 'submit' : 'button' });
    }

    return { fields, actions };
}

/**
 * The value to type into one field, or `undefined` to leave it alone.
 * `true` means "turn it on" for a checkbox or switch.
 *
 * @param {{ label:string, type:string, required?:boolean, options?:string[] }} field
 * @param {{ prefix?:string, today?:Date }} [context]
 */
export function demoValueFor(field, { prefix = LEARNING_PREFIX, today = new Date() } = {}) {
    if (field.type === 'password' || field.type === 'file' || SENSITIVE.test(field.label || '')) return undefined;

    // A prefix written as an identifier ("salesai_demo_…") asks for the same style in the rest of the value.
    const name = (slug(field.label) || 'item').replace(/-/g, prefix.endsWith('_') ? '_' : '-');
    const day = today.toISOString().slice(0, 10);
    switch (field.type) {
        case 'email':
            return `${prefix}user@example.com`;
        case 'url':
            return 'https://example.com/salesai-demo';
        case 'tel':
            return '+15555550100';
        case 'number':
        case 'range':
            return '1';
        case 'date':
            return day;
        case 'time':
            return '10:00';
        case 'datetime-local':
            return `${day}T10:00`;
        case 'color':
            return '#336699';
        case 'checkbox':
        case 'switch':
            // Leave optional toggles as they are; a required one has to be on to submit.
            return field.required ? true : undefined;
        case 'radio':
        case 'select':
        case 'combobox':
            return (field.options || []).find((option) => !PLACEHOLDER_OPTION.test(option));
        case 'textarea':
            return `${prefix}${name}: created by SalesAI to learn this screen.`;
        default:
            return `${prefix}${name}`;
    }
}

/**
 * What to type where. `provider` defaults to `demoValueFor`; pass another to source values elsewhere.
 * Fields the provider leaves undefined are skipped.
 *
 * @param {object[]} fields from `extractOverlayForm`
 */
export function planFormFill(fields, { provider = demoValueFor, prefix = LEARNING_PREFIX } = {}) {
    return fields
        .map((field) => ({ field, value: provider(field, { prefix }) }))
        .filter((step) => step.value !== undefined);
}
