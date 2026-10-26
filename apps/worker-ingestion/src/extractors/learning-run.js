import { PANEL_ACTION_WORDS } from './click-safety.js';
import { LEARNING_PREFIX, demoValueFor, extractOverlayForm, markExistingInputs, planFormFill, tagNewFormRoot } from './form-learning.js';
import { PEEK_CONFIG, diffSnapshots, snapshotPage, writesTo } from './state-discovery.js';

/**
 * Learning run: do one "create" flow for real on the demo account, watch what happens, undo it.
 *
 * Open the form behind a button, read its fields, type recognisable demo values into them, press
 * the button that saves, record what the page says in response (a notice, an error, the new row),
 * then find the row we just made and delete it — recording how deleting works too.
 *
 * Rules that keep it safe:
 * - Nothing is written unless `apply` is true. Without it the run only opens the form, plans the
 *   values and closes it again.
 * - Ownership: a run only submits when at least one value it types carries `prefix`, and only ever
 *   deletes a row whose text contains that exact value. Anything that was already in the account
 *   is never touched.
 * - Cleanup always runs (error, budget exceeded, anything) and sweeps up any leftover row that
 *   carries the prefix, including ones a run that was killed halfway left behind.
 * - A time and step budget bounds the run.
 *
 * The page is driven the way the rest of the crawler does it: small self-contained functions run
 * inside the page, tag what they find with an attribute, and the Node side acts on the tag.
 */

export const LEARN_CONFIG = {
    ...PEEK_CONFIG,
    triggerAttribute: 'data-salesai-trigger',
    rowAttribute: 'data-salesai-row',
    controlAttribute: 'data-salesai-ctl',
    rowLabelAttribute: 'data-salesai-rowlabel',
    confirmAttribute: 'data-salesai-confirm',
    // Matched with the 'iu' flags. A confirmation has a cancelling button and a confirming one side by side.
    cancelLabels: '(?:^|[^\\p{L}])(?:cancel|close|discard|back|no|iptal|kapat|vazgeç|hayır|geri)(?:[^\\p{L}]|$)',
    confirmLabels: '(?:^|[^\\p{L}])(?:delete|remove|confirm|yes|ok|sil|kaldır|evet|onayla|tamam)(?:[^\\p{L}]|$)',
    menuItemAttribute: 'data-salesai-menuitem',
    // Anything that reports back to the user in words.
    noticeSelector:
        '[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"], [data-sonner-toast], [class*="toast" i], [class*="snackbar" i], [class*="notification" i]',
    errorWords: 'required|invalid|error|already|exists|must|cannot|can\'t|failed|zorunlu|hata|geçersiz|olamaz|başarısız'
};

const CANCEL_LABEL = /(?<![\p{L}])(?:cancel|close|discard|back|no|iptal|kapat|vazgeç|hayır|geri)(?![\p{L}])/iu;
const DELETE_LABEL = /(?<![\p{L}])(?:delete|remove|trash|sil|kaldır|çöp)(?![\p{L}])/iu;
const MENU_LABEL = /(?:more|options|actions|menu|kebab|ellipsis|daha|seçenekler|işlemler|⋯|…|\.\.\.)/i;
const COMMIT_LABEL = /(?<![\p{L}])(?:create|save|add|submit|confirm|apply|done|update|oluştur|olustur|kaydet|ekle|uygula|onayla)(?![\p{L}])/iu;

const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- in the page

/** Runs INSIDE the page. Tags the visible button/link whose text is exactly `label`. */
export function tagTrigger({ label, config }) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    for (const old of document.querySelectorAll(`[${config.triggerAttribute}]`)) old.removeAttribute(config.triggerAttribute);
    const skip = config.skipRegions.join(', ');
    const target = clean(label);
    const match = [...document.querySelectorAll('button, [role="button"], a')].find(
        (el) => visible(el) && !el.closest(skip) && clean(el.getAttribute('aria-label') || el.textContent) === target
    );
    if (!match) return false;
    match.setAttribute(config.triggerAttribute, '1');
    return true;
}

/**
 * Runs INSIDE the page. What the page says after a save: notices and errors in words, whether a row
 * carrying `needle` is on the page outside the form, and whether the form is still open.
 */
export function readOutcome({ needle, config }) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const errorWords = new RegExp(config.errorWords, 'i');
    const formRoot = document.querySelector(`[${config.formRootAttribute}]`);
    // What an element shows: an input or textarea shows its value (a table that edits names in place uses them).
    const textOf = (el) => clean(el.matches('input, textarea') ? el.value : el.textContent);
    // Whole-token match: "salesai-demo-a" must not match inside "salesai-demo-a-extra" or "my-salesai-demo-a".
    // A panel may store the name in another spelling (hyphens dropped or turned into underscores), so
    // any of those spellings counts as the same name.
    const spellings = (token) => [token, token.replace(/[^A-Za-z0-9]+/g, ''), token.replace(/[^A-Za-z0-9]+/g, '_')];
    const hasToken = (text, token) =>
        spellings(token).some((spelling) =>
            new RegExp('(?:^|[^\\w.@-])' + spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^\\w.@-])', 'i').test(text)
        );

    const notices = [];
    const errors = [];
    for (const el of document.querySelectorAll(config.noticeSelector)) {
        if (!visible(el)) continue;
        const text = clean(el.textContent).slice(0, 200);
        if (!text) continue;
        // An alert, or anything said inside the form, is a problem with what was typed — whatever words it uses.
        // Other messages (toasts, status lines) are errors only when they read like one.
        const isAlert = el.matches('[role="alert"]') || Boolean(el.closest('[role="alert"]'));
        const insideForm = Boolean(formRoot && formRoot.contains(el));
        const bucket = isAlert || insideForm || errorWords.test(text) ? errors : notices;
        if (!bucket.includes(text)) bucket.push(text);
    }
    for (const el of document.querySelectorAll('[aria-invalid="true"]')) {
        const label = clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name'));
        if (label) errors.push(`${label}: invalid`);
    }

    let rowFound = false;
    for (const el of document.querySelectorAll('body *')) {
        if (!visible(el) || (formRoot && formRoot.contains(el)) || el.closest(config.noticeSelector)) continue;
        if (!hasToken(textOf(el), needle)) continue;
        // The smallest element that holds the text is the row's label; its parents only repeat it.
        if ([...el.children].some((child) => hasToken(textOf(child), needle))) continue;
        rowFound = true;
        break;
    }

    return {
        notices: notices.slice(0, 5),
        errors: errors.slice(0, 5),
        rowFound,
        formOpen: Boolean(formRoot && visible(formRoot)) || [...document.querySelectorAll(config.overlays.join(', '))].some(visible),
        url: location.href
    };
}

/**
 * Runs INSIDE the page. Tags the row that carries `needle` and lists the controls on that row.
 * The row is the smallest element holding the text, widened to the first ancestor that has controls.
 */
export function tagRowAndControls({ needle, config }) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    for (const attribute of [config.rowAttribute, config.controlAttribute, config.rowLabelAttribute]) {
        for (const old of document.querySelectorAll(`[${attribute}]`)) old.removeAttribute(attribute);
    }
    const formRoot = document.querySelector(`[${config.formRootAttribute}]`);
    // What an element shows: an input or textarea shows its value (a table that edits names in place uses them).
    const textOf = (el) => clean(el.matches('input, textarea') ? el.value : el.textContent);
    // Whole-token match: "salesai-demo-a" must not match inside "salesai-demo-a-extra" or "my-salesai-demo-a".
    // A panel may store the name in another spelling (hyphens dropped or turned into underscores), so
    // any of those spellings counts as the same name.
    const spellings = (token) => [token, token.replace(/[^A-Za-z0-9]+/g, ''), token.replace(/[^A-Za-z0-9]+/g, '_')];
    const hasToken = (text, token) =>
        spellings(token).some((spelling) =>
            new RegExp('(?:^|[^\\w.@-])' + spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^\\w.@-])', 'i').test(text)
        );

    let label = null;
    for (const el of document.querySelectorAll('body *')) {
        if (!visible(el) || (formRoot && formRoot.contains(el)) || el.closest(config.noticeSelector)) continue;
        if (!hasToken(textOf(el), needle)) continue;
        if ([...el.children].some((child) => hasToken(textOf(child), needle))) continue;
        label = el;
        break;
    }
    if (!label) return { found: false, controls: [] };
    // Hovering this reveals row controls that only show under the pointer.
    label.setAttribute(config.rowLabelAttribute, '1');

    const controlSelector = 'button, [role="button"], [role="menuitem"], a[href], [aria-haspopup]';
    // The row is the nearest ancestor with a control on it; a few levels at most, or it is the page and not a row.
    let row = label;
    let levels = 0;
    while (row && row !== document.body && levels < 6 && ![...row.querySelectorAll(controlSelector)].some(visible)) {
        row = row.parentElement;
        levels++;
    }
    if (!row || row === document.body || levels >= 6) {
        return { found: true, row: false, controls: [], html: (label.parentElement || label).outerHTML.slice(0, 1200) };
    }
    // Never widen into something that holds more than one row of ours.
    // The row's words, plus what its input boxes hold (an input has no text of its own).
    const rowText = clean(row.textContent) + ' ' + [...row.querySelectorAll('input, textarea')].map((el) => clean(el.value)).join(' ');
    // A container that holds more than one row of ours is not a row.
    const variants = spellings(needle);
    const rowsInside = [...row.querySelectorAll('*')].filter(
        (el) => variants.some((v) => textOf(el) === v) && !(el.children.length && [...el.children].some((child) => variants.some((w) => textOf(child) === w)))
    ).length;
    if (rowsInside > 1 && variants.every((v) => rowText.split(v).length - 1 > 1)) return { found: true, row: false, controls: [] };

    // A row is small. When no real row has controls, the nearest ancestor that does can be a whole section of the
    // page (its header buttons, other lists): pressing anything in there could delete something that is not ours.
    if (row.getBoundingClientRect().height > 220) {
        return { found: true, row: false, controls: [], html: (label.parentElement || label).outerHTML.slice(0, 1200) };
    }

    row.setAttribute(config.rowAttribute, '1');
    const controls = [];
    // A control belongs to the row only if it sits on the row's own line: level with the name, give or take a
    // little. A button elsewhere in the same section of the page is not this row's.
    const line = label.getBoundingClientRect();
    for (const el of row.querySelectorAll(controlSelector)) {
        if (!visible(el)) continue;
        const rect = el.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        if (middle < line.top - 40 || middle > line.bottom + 40) continue;
        el.setAttribute(config.controlAttribute, String(controls.length));
        controls.push({
            label: clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent),
            popup: el.hasAttribute('aria-haspopup')
        });
    }
    return { found: true, row: true, controls, html: row.outerHTML.slice(0, 1200) };
}

/**
 * Runs INSIDE the page. Tags the items of the menu the control `anchorSelector` just opened, and lists them.
 *
 * A menu that declares itself (role menu/menuitem/option) is read as it is. Many apps draw plain elements
 * instead, so then the menu is whatever short text is on top of the page right below the button that opened
 * it: that is where a menu appears, and it keeps this from ever reaching a "Delete" somewhere else on the page.
 */
export function tagMenuItems({ config, anchorSelector }) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    for (const old of document.querySelectorAll(`[${config.menuItemAttribute}]`)) old.removeAttribute(config.menuItemAttribute);

    const labels = [];
    const tag = (el, label) => {
        el.setAttribute(config.menuItemAttribute, String(labels.length));
        labels.push(label);
    };

    const declared = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button, [role="menu"] a, [role="option"]')].filter(visible);
    if (declared.length) {
        for (const el of declared) tag(el, clean(el.getAttribute('aria-label') || el.textContent));
        return labels;
    }

    const anchor = anchorSelector ? document.querySelector(anchorSelector) : null;
    if (!anchor) return labels;
    const box = anchor.getBoundingClientRect();
    const near = (rect) =>
        rect.left >= box.right - 240 && rect.right <= box.right + 80 && rect.top >= box.bottom - 24 && rect.top <= box.bottom + 460;
    const leaves = [...document.querySelectorAll('body *')].filter((el) => {
        if (!visible(el) || anchor.contains(el)) return false;
        const text = clean(el.textContent);
        if (!text || text.length > 30 || [...el.children].some((child) => clean(child.textContent))) return false;
        const rect = el.getBoundingClientRect();
        if (!near(rect)) return false;
        // On top: not something the menu is covering.
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(top) && (top === el || el.contains(top) || top.contains(el));
    });
    leaves.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    for (const el of leaves) tag(el.closest('button, [role], li, a') || el, clean(el.textContent));
    return labels;
}

/**
 * Runs INSIDE the page. Finds the confirmation that is open: a box with a cancelling and a confirming button
 * side by side, drawn on top of the page.
 *
 * Looked for by what it is rather than by a role, because plenty of apps draw their modals as plain elements.
 * Only a box on a fixed layer (or declaring a dialog role) and on top counts, so a Cancel/Delete pair somewhere
 * in the page itself, or a menu that is still open, is never taken for the confirmation.
 */
export function findConfirmation(config) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const cancelLabel = new RegExp(config.cancelLabels, 'iu');
    const confirmLabel = new RegExp(config.confirmLabels, 'iu');
    for (const old of document.querySelectorAll(`[${config.confirmAttribute}]`)) old.removeAttribute(config.confirmAttribute);

    const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].filter(visible);
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || el.value);
    const declaresDialog = (node) => ['dialog', 'alertdialog'].includes(node.getAttribute('role')) || node.getAttribute('aria-modal') === 'true';
    const onFixedLayer = (el) => {
        for (let node = el; node && node !== document.body; node = node.parentElement) {
            if (getComputedStyle(node).position === 'fixed' || declaresDialog(node)) return true;
        }
        return false;
    };
    const onTop = (el) => {
        // Whether something is on top can only be asked of what is on screen: scroll a button that is off it into view.
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(top) && (top === el || el.contains(top) || top.contains(el));
    };

    for (const confirm of buttons) {
        const label = labelOf(confirm);
        if (!label || cancelLabel.test(label) || !confirmLabel.test(label) || !onTop(confirm)) continue;
        // The smallest box that also holds a cancelling button.
        let box = confirm.parentElement;
        while (box && box !== document.body && !buttons.some((b) => b !== confirm && box.contains(b) && cancelLabel.test(labelOf(b)))) box = box.parentElement;
        if (!box || box === document.body || !onFixedLayer(box)) continue;
        // A box that does not declare itself a dialog has to look like one: not a whole section of the page.
        const rect = box.getBoundingClientRect();
        if (!declaresDialog(box) && (rect.width > 900 || rect.height > 600)) continue;
        confirm.setAttribute(config.confirmAttribute, '1');

        // The smallest box with both buttons is often just the button row (a footer). What the confirmation SAYS
        // is in the box around it: widen until there is more than button labels, without leaving the modal.
        // Read as the lines the person sees, with the buttons taken out: they are hidden while the text is read and
        // put back after, so a word the title and a button share ("Delete variable" / "Delete") stays whole and
        // buttons that sit on one line ("Cancel" "Delete") do not run together.
        const buttonLabels = buttons.filter((b) => box.contains(b)).map(labelOf);
        const linesOf = (el) => {
            const hidden = buttons.filter((b) => el.contains(b)).map((b) => [b, b.style.display]);
            for (const [b] of hidden) b.style.display = 'none';
            // `??`, not `||`: with the buttons hidden an empty innerText is the right answer, not a missing one.
            const text = el.innerText ?? el.textContent ?? '';
            for (const [b, display] of hidden) b.style.display = display;
            return text.split('\n').map(clean).filter(Boolean);
        };
        const wordsOf = (el) => linesOf(el).join(' ');
        let read = box;
        while (read.parentElement && read.parentElement !== document.body && wordsOf(read).length < 12) {
            const next = read.parentElement;
            const size = next.getBoundingClientRect();
            if (!declaresDialog(next) && (size.width > 900 || size.height > 600)) break;
            read = next;
        }
        const lines = linesOf(read);
        const heading = read.querySelector('h1, h2, h3, h4, [role="heading"]');
        const title = clean(heading?.textContent) || lines[0] || '';
        return {
            title,
            // What it says besides its title.
            text: lines.filter((line) => line !== title).join(' ').slice(0, 300),
            confirm: label,
            buttons: buttonLabels
        };
    }
    return null;
}

/** Runs INSIDE the page. The first text on the page that starts with `prefix`, whole. */
export function findOwnedText({ prefix, config }) {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const formRoot = document.querySelector(`[${config.formRootAttribute}]`);
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const textOf = (el) => clean(el.matches('input, textarea') ? el.value : el.textContent);
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A token that STARTS with the prefix ("my-salesai-demo-x" is somebody else's name).
    const pattern = new RegExp('(?:^|[^\\w.@-])(' + escaped + '[\\w.@-]*)');
    for (const el of document.querySelectorAll('body *')) {
        if (!visible(el) || (formRoot && formRoot.contains(el))) continue;
        if ([...el.children].some((child) => pattern.test(textOf(child)))) continue;
        const match = pattern.exec(textOf(el));
        if (match) return match[1];
    }
    return null;
}

// ------------------------------------------------------------------- on our side

class BudgetExceeded extends Error {}

function createBudget({ maxMs, maxSteps }) {
    const startedAt = Date.now();
    let steps = 0;
    return {
        spend(what) {
            steps++;
            if (steps > maxSteps) throw new BudgetExceeded(`step budget of ${maxSteps} used up before "${what}"`);
            if (Date.now() - startedAt > maxMs) throw new BudgetExceeded(`time budget of ${maxMs}ms used up before "${what}"`);
        },
        get steps() { return steps; }
    };
}

/** The button that saves: not a cancel, preferring a real submit, then a "create/save/add" label. */
export function pickCommitAction(actions) {
    const candidates = actions.map((action, index) => ({ ...action, index })).filter((action) => !CANCEL_LABEL.test(action.label));
    return (
        candidates.find((action) => action.kind === 'submit') ||
        candidates.find((action) => COMMIT_LABEL.test(action.label)) ||
        candidates[candidates.length - 1] ||
        null
    );
}

/** The same prefix written as an identifier: letters, digits and underscores only ("salesai-demo-" -> "salesai_demo_"). */
export const safePrefix = (value) => value.replace(/[^A-Za-z0-9]+/g, '_');

/** A label for what we are about to press must not be a publish/run/billing action. */
const isSafeToCommit = (label) => !PANEL_ACTION_WORDS.test(label) && !DELETE_LABEL.test(label);

async function press(page, selector, { timeout = 2000 } = {}) {
    const handle = await page.$(selector);
    if (!handle) return false;
    await handle.click({ timeout });
    return true;
}

async function fillField(page, index, field, value) {
    const handle = await page.$(`[${LEARN_CONFIG.fieldAttribute}="${index}"]`);
    if (!handle) return false;
    if (field.type === 'select') {
        await handle.selectOption({ label: String(value) });
    } else if (field.type === 'checkbox' || field.type === 'radio') {
        await handle.check();
    } else if (field.type === 'switch') {
        if ((await handle.getAttribute('aria-checked')) !== 'true') await handle.click();
    } else if (field.type === 'combobox') {
        return false;
    } else {
        await handle.fill(String(value));
    }
    return true;
}

/** Closes whatever the trigger opened: its cancel button, Escape, or a reload as the last resort. */
async function closeForm(page, form, { listUrl, settle }) {
    const cancel = form?.actions?.findIndex((action) => CANCEL_LABEL.test(action.label)) ?? -1;
    if (cancel >= 0 && (await press(page, `[${LEARN_CONFIG.actionAttribute}="${cancel}"]`).catch(() => false))) {
        await page.waitForTimeout(300);
        return;
    }
    await Promise.resolve(page.keyboard?.press?.('Escape')).catch(() => {});
    await page.waitForTimeout(200);
    const open = await page.evaluate(readOutcome, { needle: '\u0000', config: LEARN_CONFIG }).catch(() => ({ formOpen: false }));
    if (!open.formOpen) return;
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await settle(page);
}

/**
 * Deletes the row that carries `needle`: straight from a button on the row, or through the row's
 * menu, then through the confirmation if one appears. Records every press.
 * @returns {Promise<{ steps:object[], confirmation?:{title:string,text:string} } | null>} null when it could not.
 */
export async function deleteOwnedRow(page, needle, { settle, budget = null, trace = {} } = {}) {
    const spend = (what) => budget?.spend(what);
    const steps = [];

    const rowInfo = async () => page.evaluate(tagRowAndControls, { needle, config: LEARN_CONFIG });
    let info = await rowInfo();
    // Row controls are often drawn only while the pointer is over the row: look again after hovering its label.
    if (info.found) {
        await page.hover(`[${LEARN_CONFIG.rowLabelAttribute}]`).catch(() => {});
        await page.waitForTimeout(250);
        info = await rowInfo();
    }
    trace.found = info.found;
    trace.row = Boolean(info.row);
    trace.controls = info.controls.map((control) => control.label || '(no label)');
    if (info.html) trace.html = info.html;
    if (!info.found) { trace.reason = 'the row is not on the page'; return null; }
    if (!info.row) { trace.reason = 'found the text but no row with controls around it'; return null; }
    // Forget the form that was open before, so a confirmation dialog is read as itself.
    await page.evaluate(markExistingInputs, LEARN_CONFIG).catch(() => {});

    const rowControl = (matcher) => info.controls.findIndex((control) => matcher(control));
    let deleteIndex = rowControl((control) => DELETE_LABEL.test(control.label));

    if (deleteIndex >= 0) {
        spend(`press ${info.controls[deleteIndex].label}`);
        await press(page, `[${LEARN_CONFIG.controlAttribute}="${deleteIndex}"]`);
        steps.push({ action: 'press', where: 'row', label: info.controls[deleteIndex].label });
    } else {
        let menuIndex = rowControl((control) => MENU_LABEL.test(control.label) || control.popup);
        // A row's "⋯" is usually an icon with no label at all, and usually the last control on the row.
        if (menuIndex === -1) {
            const unlabeled = info.controls.map((control, index) => ({ control, index })).filter(({ control }) => !control.label);
            if (unlabeled.length) menuIndex = unlabeled[unlabeled.length - 1].index;
        }
        if (menuIndex === -1) { trace.reason = 'the row has no delete button and no menu button'; return null; }
        spend(`open ${info.controls[menuIndex].label}`);
        await press(page, `[${LEARN_CONFIG.controlAttribute}="${menuIndex}"]`);
        steps.push({ action: 'press', where: 'row', label: info.controls[menuIndex].label || '(icon button)' });
        await page.waitForTimeout(300);
        const items = await page.evaluate(tagMenuItems, {
            config: LEARN_CONFIG,
            anchorSelector: `[${LEARN_CONFIG.controlAttribute}="${menuIndex}"]`
        });
        const itemIndex = items.findIndex((label) => DELETE_LABEL.test(label));
        trace.menuItems = items;
        if (itemIndex === -1) { trace.reason = 'the row menu has no delete item'; return null; }
        spend(`press ${items[itemIndex]}`);
        await press(page, `[${LEARN_CONFIG.menuItemAttribute}="${itemIndex}"]`);
        steps.push({ action: 'press', where: 'menu', label: items[itemIndex] });
    }
    await page.waitForTimeout(400);

    // A confirmation, if the page asks for one.
    let confirmation;
    const found = await page.evaluate(findConfirmation, LEARN_CONFIG).catch(() => null);
    if (found) {
        confirmation = { title: found.title, text: found.text };
        spend(`press ${found.confirm}`);
        await press(page, `[${LEARN_CONFIG.confirmAttribute}]`);
        steps.push({ action: 'press', where: 'confirmation', label: found.confirm });
        await page.waitForTimeout(400);
    }

    await settle?.(page);
    const after = await page.evaluate(readOutcome, { needle, config: LEARN_CONFIG });
    if (after.rowFound) {
        trace.reason = 'pressed delete but the row is still on the page';
        trace.steps = steps;
        return null;
    }
    return { steps, ...(confirmation && { confirmation }) };
}

/** Deletes every row on `listUrl` that carries the prefix. Returns how many are left that it could not delete. */
export async function sweepOwnedRows(page, listUrl, { prefix = LEARNING_PREFIX, prefixes = [prefix, safePrefix(prefix), prefix.replace(/[^A-Za-z0-9]+/g, '')], settle, settleAction = settle, budget = null, maxRows = 10 } = {}) {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await settle(page);
    let deleted = 0;
    for (let i = 0; i < maxRows; i++) {
        let needle = null;
        for (const owned of prefixes) {
            needle = await page.evaluate(findOwnedText, { prefix: owned, config: LEARN_CONFIG }).catch(() => null);
            if (needle) break;
        }
        if (!needle) return { deleted, left: 0 };
        const trace = {};
        const result = await deleteOwnedRow(page, needle, { settle: settleAction, budget, trace }).catch((error) => {
            trace.reason = error.message;
            return null;
        });
        if (!result) return { deleted, left: 1, stuck: { needle, ...trace } };
        deleted++;
    }
    return { deleted, left: 1 };
}

/**
 * @param {import('playwright').Page} page
 * @param {{
 *   listUrl:string, trigger:string,
 *   settle:(page:import('playwright').Page)=>Promise<void>,       waits for a page LOAD to render (patient)
 *   settleAction?:(page:import('playwright').Page)=>Promise<void>, waits after a press (quick); defaults to settle
 *   apply?:boolean, prefix?:string, valueProvider?:Function, runId?:string, maxMs?:number, maxSteps?:number,
 *   onSnapshot?:(label:string, page:import('playwright').Page)=>Promise<void>  called at the moments worth looking at (to save a screenshot, say)
 * }} options
 */
export async function learnCreateFlow(page, {
    listUrl,
    trigger,
    settle,
    settleAction = settle,
    apply = false,
    prefix = LEARNING_PREFIX,
    valueProvider = demoValueFor,
    runId = Math.random().toString(36).slice(2, 8),
    maxMs = 120_000,
    maxSteps = 40,
    onSnapshot = null
}) {
    const startedAt = Date.now();
    const budget = createBudget({ maxMs, maxSteps });
    const result = { trigger, listUrl, applied: false, steps: [], errors: [] };
    const note = (step) => result.steps.push(step);

    const requests = [];
    const onRequest = (request) => requests.push({ method: request.method(), url: request.url() });
    page.on?.('request', onRequest);

    let form = null;
    let needle = null;
    try {
        budget.spend('open the list');
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await settle(page);

        budget.spend(`find "${trigger}"`);
        if (!(await page.evaluate(tagTrigger, { label: trigger, config: LEARN_CONFIG }))) {
            result.errors.push(`no visible button labelled "${trigger}" on ${listUrl}`);
            return result;
        }

        const before = await page.evaluate(snapshotPage, LEARN_CONFIG);
        await page.evaluate(markExistingInputs, LEARN_CONFIG);
        budget.spend(`press "${trigger}"`);
        await press(page, `[${LEARN_CONFIG.triggerAttribute}]`);
        note({ action: 'press', where: 'page', label: trigger });

        // A panel can take a moment to slide in and draw: look for the form for a few seconds, not once.
        let hasPanel = false;
        for (let attempt = 0; attempt < 10 && !form?.fields?.length; attempt++) {
            await page.waitForTimeout(300);
            hasPanel = await page.evaluate(tagNewFormRoot, LEARN_CONFIG).catch(() => false);
            form = await page.evaluate(extractOverlayForm, LEARN_CONFIG).catch(() => null);
        }
        if (!form || !form.fields.length) {
            result.errors.push(`pressing "${trigger}" did not open a form${hasPanel ? ' with fields' : ''}`);
            // What the page did instead, so the reason can be seen rather than guessed.
            const after = await page.evaluate(snapshotPage, LEARN_CONFIG).catch(() => null);
            if (after) {
                const diff = diffSnapshots(before, after);
                result.diagnostics = {
                    urlChanged: diff.urlChanged,
                    url: after.url,
                    openSurfaces: diff.overlays.map((overlay) => `${overlay.kind}: ${overlay.title || overlay.text.slice(0, 60)}`),
                    newControls: diff.newElements.map((item) => `${item.label} [${item.kind}]`)
                };
            }
            return result;
        }

        result.form = form;
        const commit = pickCommitAction(form.actions);
        result.commit = commit ? { label: commit.label, kind: commit.kind } : null;

        // Every value of this run carries a prefix and a run id, so no other row in the account can share its name.
        // Names are first tried with hyphens; a panel that only accepts letters, digits and underscores rejects
        // them, so a rejected save is tried once more with an identifier-safe name.
        const ownedPrefixes = [prefix, safePrefix(prefix)];
        const attemptPrefixes = [`${prefix}${runId}-`, `${safePrefix(prefix)}${runId}_`];
        const planFor = (attemptPrefix) => planFormFill(form.fields, { provider: valueProvider, prefix: attemptPrefix });
        const isOwned = (value) => typeof value === 'string' && ownedPrefixes.some((owned) => value.startsWith(owned));

        const firstPlan = planFor(attemptPrefixes[0]);
        result.plan = firstPlan.map(({ field, value }) => ({ label: field.label, type: field.type, value }));

        if (!apply) return result;

        if (!firstPlan.some((step) => isOwned(step.value))) {
            result.errors.push('refusing to submit: none of the values carries the learning prefix, so the result could not be told from existing data');
            return result;
        }
        if (!commit || !isSafeToCommit(commit.label)) {
            result.errors.push(`refusing to submit: ${commit ? `"${commit.label}" is not a safe button to press` : 'no button that saves was found'}`);
            return result;
        }

        result.applied = true;
        result.attempts = [];
        for (const attemptPrefix of attemptPrefixes) {
            const plan = planFor(attemptPrefix);
            // Ownership marker: the one value we later look for to find, and only ever delete, our own row.
            needle = plan.map((step) => step.value).find(isOwned) || null;
            if (!needle) break;
            result.needle = needle;

            for (let i = 0; i < form.fields.length; i++) {
                const step = plan.find((entry) => entry.field === form.fields[i]);
                if (!step) continue;
                budget.spend(`fill ${form.fields[i].label}`);
                const filled = await fillField(page, i, form.fields[i], step.value).catch(() => false);
                note({ action: 'fill', label: form.fields[i].label, type: form.fields[i].type, value: step.value, ok: filled });
            }

            requests.length = 0;
            const beforeSave = await page.evaluate(snapshotPage, LEARN_CONFIG).catch(() => null);
            await onSnapshot?.(`filled-${result.attempts.length + 1}`, page);
            budget.spend(`press "${commit.label}"`);
            await press(page, `[${LEARN_CONFIG.actionAttribute}="${commit.index}"]`);
            note({ action: 'press', where: 'form', label: commit.label });
            await page.waitForTimeout(800);
            await settleAction(page);

            await onSnapshot?.(`saved-${result.attempts.length + 1}`, page);
            const outcome = await page.evaluate(readOutcome, { needle, config: LEARN_CONFIG });
            const afterSave = await page.evaluate(snapshotPage, LEARN_CONFIG).catch(() => null);
            // Only what the page wrote to its own site: analytics and ad pixels are not what the save did.
            const writes = writesTo(requests, new URL(listUrl).hostname);
            // What the page changed in response, whatever it did, so a result we cannot classify can still be understood.
            const observed = beforeSave && afterSave ? diffSnapshots(beforeSave, afterSave) : null;
            result.outcome = {
                status: outcome.rowFound ? 'created' : outcome.errors.length ? 'rejected' : 'unknown',
                notices: outcome.notices,
                errors: outcome.errors,
                formStillOpen: outcome.formOpen,
                urlChanged: outcome.url !== listUrl,
                writeRequests: writes,
                ...(observed && {
                    appeared: observed.newElements.map((item) => `${item.label} [${item.kind}]`).slice(0, 12),
                    surfaces: observed.overlays.map((overlay) => `${overlay.kind}: ${overlay.title || overlay.text.slice(0, 60)}`)
                })
            };
            result.attempts.push({ needle, status: result.outcome.status, errors: outcome.errors });

            if (outcome.rowFound) {
                // The way back: how this list deletes a row.
                result.deleteTrace = {};
                result.deleteFlow = await deleteOwnedRow(page, needle, { settle: settleAction, budget, trace: result.deleteTrace });
                if (!result.deleteFlow) await onSnapshot?.('delete-failed', page);
                if (!result.deleteFlow) result.errors.push('created the row but could not work out how to delete it (cleanup will try again)');
                break;
            }
            // Only a rejection that left the form open can be retried with another name.
            if (!(outcome.errors.length && outcome.formOpen)) break;
        }
    } catch (error) {
        result.errors.push(error.message);
    } finally {
        page.off?.('request', onRequest);
        if (apply && result.applied) {
            // Always, and with a budget of its own: a run that failed halfway must not leave its row behind.
            const cleanupBudget = createBudget({ maxMs: 60_000, maxSteps: 30 });
            const swept = await sweepOwnedRows(page, listUrl, { prefix, settle, settleAction, budget: cleanupBudget }).catch((error) => {
                result.errors.push(`cleanup failed: ${error.message}`);
                return { deleted: 0, left: 1 };
            });
            result.cleanup = swept;
        } else if (form) {
            await closeForm(page, form, { listUrl, settle }).catch(() => {});
        }
        result.durationMs = Date.now() - startedAt;
        result.stepCount = budget.steps;
    }
    return result;
}
