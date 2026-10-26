/**
 * Procedures: turning what a learning run saw into a recipe an agent can follow and a retrieval can find.
 *
 * `buildProcedure` takes the result of a learning run (apps/worker-ingestion `learnCreateFlow`: which button
 * opened which form, what was typed, what the page did, how the row was deleted) and returns a structured
 * record. Only a flow that was seen all the way through becomes one — created AND undone — so an agent is
 * never handed a recipe whose last half nobody has tried.
 *
 * `renderProcedureText` writes the record as plain, numbered prose (English or Turkish), with the exact button
 * labels. That text is what gets embedded: a retrieval hit alone already tells the agent every step.
 *
 * Pure functions, no I/O.
 */

export const PROCEDURE_VERSION = 1;

/** Every button label a procedure presses, to do it and to undo it: what a live demo may click. */
export function procedureLabels(procedure) {
    const labels = [
        ...(procedure.steps || []).filter((step) => step.action === 'press').map((step) => step.label),
        ...(procedure.undo?.steps || []).filter((step) => step.action !== 'fill').map((step) => step.label)
    ];
    return [...new Set(labels.filter((label) => label && label !== '(icon button)'))];
}

const CREATE_VERB = /^(?:new|create|add|yeni|oluştur|ekle)\s+/i;

const slugify = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);

/** `/project/6ab4…/cms/variable` → `/project/:id/cms/variable`, so a recipe reads the same on any project. */
export function pagePathOf(url) {
    try {
        return new URL(url).pathname
            .split('/')
            .map((part) => (/^[0-9a-f]{24}$/i.test(part) || /^[0-9a-f-]{32,36}$/i.test(part) ? ':id' : part))
            .join('/');
    } catch {
        return url;
    }
}

/** Stable per product: the last two path segments and the button, e.g. `cms-variable--new-variable`. */
export function procedureSlug({ pageUrl, trigger }) {
    let tail = '';
    try {
        tail = new URL(pageUrl).pathname
            .split('/')
            .filter((part) => part && !/^[0-9a-f]{24}$/i.test(part))
            .slice(-2)
            .join('-');
    } catch { /* not a URL: the button alone has to identify it */ }
    return [slugify(tail), slugify(trigger)].filter(Boolean).join('--');
}

/** "New variable" → "variable": what the button creates. Falls back to the whole label. */
export function subjectOf(trigger) {
    const rest = String(trigger || '').trim().replace(CREATE_VERB, '').trim();
    return rest || String(trigger || '').trim();
}

/** A "message" that is only the buttons' own labels ("CancelDelete") says nothing; it is not kept. */
function meaningfulConfirmation(confirmation, buttonLabels) {
    if (!confirmation) return null;
    const strip = (text) => buttonLabels.reduce((rest, label) => rest.split(label).join(''), String(text || '')).replace(/\s+/g, '').trim();
    let text = String(confirmation.text || '').trim();
    const title = String(confirmation.title || '').trim();
    if (!strip(text) && !strip(title)) return null;
    // A message that opens with the title, or is the title, only repeats it.
    if (title && text === title) text = '';
    else if (title && text.startsWith(title)) text = text.slice(title.length).trim();
    return { title: strip(title) ? title : '', text: strip(text) ? text : '' };
}

/**
 * What a pressed element is, as the live browser will describe it, plus what it is for when that is known.
 * Kept with the step so a demo that cannot find a button by its label has something else to go on
 * (same kind of element, same purpose) without the flow being learned again.
 */
function describePress(step, purposes) {
    const purpose = purposes?.[step.label];
    return { ...step, role: step.where === 'menu' ? 'menuitem' : 'button', ...(purpose && { purpose }) };
}

/**
 * @param {object} result  what `learnCreateFlow` returned
 * @param {{ language?:'en'|'tr', now?:Date, purposes?:Record<string,string> }} [options]
 *   `purposes` maps a button label to its "what is this for" line, when the crawl has one.
 * @returns {{ ok:true, procedure:object } | { ok:false, reason:string }}
 */
export function buildProcedure(result, { language = 'en', now = new Date(), purposes = null } = {}) {
    if (!result?.applied) return { ok: false, reason: 'the flow was only read, never carried out' };
    if (result.outcome?.status !== 'created') return { ok: false, reason: `the save did not create anything (${result.outcome?.status || 'no outcome'})` };
    if (!result.deleteFlow?.steps?.length) return { ok: false, reason: 'how to undo it was never seen, so the flow is only half known' };
    if (!result.form?.fields?.length || !result.commit?.label) return { ok: false, reason: 'the form or its save button was not read' };

    const fields = result.form.fields
        .filter((field) => field.label || field.type !== 'checkbox')
        .map(({ label, type, required, options, placeholder }) => ({
            label: label || placeholder || '',
            type,
            required: Boolean(required),
            ...(options?.length && { options }),
            ...(placeholder && placeholder !== label && { placeholder })
        }))
        .filter((field) => field.label);
    const requiredByLabel = new Map(fields.map((field) => [field.label, field.required]));

    const filled = (result.steps || [])
        .filter((step) => step.action === 'fill' && step.ok !== false && step.label)
        .map((step) => ({
            action: 'fill',
            label: step.label,
            type: step.type,
            required: requiredByLabel.get(step.label) ?? false,
            // What the demo typed. A live demo picks a realistic value of its own.
            example: step.value
        }));

    const cancel = result.form.actions?.find((action) => /(?:^|[^\p{L}])(?:cancel|close|iptal|kapat|vazgeç)(?:[^\p{L}]|$)/iu.test(action.label))?.label;
    const buttonLabels = (result.form.actions || []).map((action) => action.label);

    const attempts = result.attempts || [];
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    const nameRule = rejected
        ? { rejectedWith: rejected.errors, acceptedStyle: 'letters, digits and underscores only' }
        : undefined;

    const confirmation = meaningfulConfirmation(result.deleteFlow.confirmation, [...buttonLabels, ...result.deleteFlow.steps.map((step) => step.label)]);

    const subject = subjectOf(result.trigger);
    const procedure = {
        slug: procedureSlug({ pageUrl: result.listUrl, trigger: result.trigger }),
        kind: 'create',
        language,
        title: language === 'tr' ? `${subject} oluştur` : `Create a ${subject}`,
        subject,
        pageUrl: result.listUrl,
        pagePath: pagePathOf(result.listUrl),
        trigger: result.trigger,
        form: { fields, submit: result.commit.label, ...(cancel && { cancel }) },
        steps: [
            { n: 1, action: 'open', url: result.listUrl, path: pagePathOf(result.listUrl) },
            describePress({ n: 2, action: 'press', where: 'page', label: result.trigger }, purposes),
            ...filled.map((step, index) => ({ n: 3 + index, ...step })),
            describePress({ n: 3 + filled.length, action: 'press', where: 'form', label: result.commit.label }, purposes)
        ],
        expect: {
            status: 'created',
            notices: result.outcome.notices || [],
            ...(result.outcome.appeared?.length && { appeared: result.outcome.appeared }),
            ...(nameRule && { nameRule })
        },
        undo: {
            steps: result.deleteFlow.steps.map(({ action, where, label }) => describePress({ action, where, label }, purposes)),
            ...(confirmation && { confirmation })
        },
        safety: { createsRecord: true, undoable: true },
        version: PROCEDURE_VERSION,
        learnedAt: now
    };
    return { ok: true, procedure };
}

// ------------------------------------------------------------------------------------------ text

const WORDS = {
    en: {
        header: (p) => `How to ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)} on the page ${p.pagePath}`,
        open: (p) => `Open the page ${p.url}.`,
        pressTrigger: (label, fields) => `Press "${label}".${fields ? ` A form opens asking for: ${fields}.` : ''}`,
        fill: (labels) => `Fill in ${labels}.`,
        fillOptional: (labels) => `Optionally also fill in ${labels}.`,
        pressSubmit: (label) => `Press "${label}".`,
        result: 'Result',
        created: 'a new entry appears in the list',
        says: (notices) => `the page says ${notices.map((n) => `"${n}"`).join(' / ')}`,
        undo: 'To undo it',
        rowButton: 'the icon button at the end of the row (usually "⋯")',
        pressOnRow: (label) => (label === '(icon button)' ? `press ${WORDS.en.rowButton}` : `press "${label}" on the row`),
        pickMenu: (label) => `choose "${label}" from the menu that opens`,
        confirmWith: (label, message) => `confirm with "${label}"${message ? ` (the page asks: ${message})` : ''}`,
        pressGeneric: (label) => `press "${label}"`,
        nameRule: (errors) => `Names: a first attempt was rejected${errors?.length ? ` ("${errors[0]}")` : ''}; use letters, digits and underscores only.`,
        required: 'required',
        types: {}
    },
    tr: {
        header: (p) => `${p.pagePath} sayfasında ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)} nasıl yapılır`,
        open: (p) => `${p.url} sayfasını aç.`,
        pressTrigger: (label, fields) => `"${label}" düğmesine bas.${fields ? ` Şunları isteyen bir form açılır: ${fields}.` : ''}`,
        fill: (labels) => `${labels} alanlarını doldur.`,
        fillOptional: (labels) => `İstersen ${labels} alanlarını da doldur.`,
        pressSubmit: (label) => `"${label}" düğmesine bas.`,
        result: 'Sonuç',
        created: 'listede yeni bir kayıt görünür',
        says: (notices) => `sayfa şunu söyler: ${notices.map((n) => `"${n}"`).join(' / ')}`,
        undo: 'Geri almak için',
        rowButton: 'satırın sonundaki simge düğmesine (genellikle "⋯")',
        pressOnRow: (label) => (label === '(icon button)' ? `${WORDS.tr.rowButton} bas` : `satırdaki "${label}" düğmesine bas`),
        pickMenu: (label) => `açılan menüden "${label}" seçeneğini seç`,
        confirmWith: (label, message) => `"${label}" ile onayla${message ? ` (sayfa şunu sorar: ${message})` : ''}`,
        pressGeneric: (label) => `"${label}" düğmesine bas`,
        nameRule: (errors) => `Adlar: ilk deneme reddedildi${errors?.length ? ` ("${errors[0]}")` : ''}; yalnızca harf, rakam ve alt çizgi kullan.`,
        required: 'zorunlu',
        types: { text: 'metin', textarea: 'uzun metin', select: 'seçim', checkbox: 'onay kutusu', email: 'e-posta', number: 'sayı', url: 'adres', tel: 'telefon', date: 'tarih', radio: 'seçenek', switch: 'anahtar' }
    }
};

const describeField = (field, words) => {
    const type = words.types[field.type] || field.type;
    const notes = [type, field.required ? words.required : null].filter(Boolean).join(', ');
    return `${field.label}${notes ? ` (${notes})` : ''}`;
};

/**
 * The recipe as numbered prose. `description` (what the flow is for) goes first when there is one.
 * @param {object} procedure
 * @param {{ description?:string }} [options]
 */
export function renderProcedureText(procedure, { description = '' } = {}) {
    const words = WORDS[procedure.language] || WORDS.en;
    const fields = procedure.form?.fields || [];
    const filled = procedure.steps.filter((step) => step.action === 'fill');
    const required = filled.filter((step) => step.required).map((step) => step.label);
    const optional = filled.filter((step) => !step.required).map((step) => step.label);

    const lines = [`${words.header({ title: procedure.title, pagePath: procedure.pagePath })}:`];
    if (description) lines.push(description.trim());

    let number = 1;
    lines.push(`${number++}. ${words.open({ url: procedure.pageUrl })}`);
    lines.push(`${number++}. ${words.pressTrigger(procedure.trigger, fields.map((field) => describeField(field, words)).join(', '))}`);
    // Required fields first; the rest are optional. When the panel does not say which is which, all are "fill in".
    if (required.length) lines.push(`${number++}. ${words.fill(required.map((label) => `"${label}"`).join(', '))}`);
    if (optional.length) lines.push(`${number++}. ${required.length ? words.fillOptional(optional.map((label) => `"${label}"`).join(', ')) : words.fill(optional.map((label) => `"${label}"`).join(', '))}`);
    lines.push(`${number++}. ${words.pressSubmit(procedure.form.submit)}`);

    const result = [words.created];
    if (procedure.expect.notices?.length) result.push(words.says(procedure.expect.notices));
    lines.push(`${words.result}: ${result.join('; ')}.`);
    if (procedure.expect.nameRule) lines.push(words.nameRule(procedure.expect.nameRule.rejectedWith));

    const undo = procedure.undo.steps.map((step) => {
        if (step.where === 'row') return words.pressOnRow(step.label);
        if (step.where === 'menu') return words.pickMenu(step.label);
        if (step.where === 'confirmation') {
            const message = [procedure.undo.confirmation?.title, procedure.undo.confirmation?.text].filter(Boolean).join(': ');
            return words.confirmWith(step.label, message && message.length < 200 ? message : '');
        }
        return words.pressGeneric(step.label);
    });
    lines.push(`${words.undo}: ${undo.join(' → ')}.`);
    return lines.join('\n');
}
