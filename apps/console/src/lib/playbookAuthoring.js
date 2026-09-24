export const PLAYBOOK_IMPORTANCE_OPTIONS = Object.freeze([
    { value: 'flexible', label: 'Esnek' },
    { value: 'important', label: 'Önemli' },
    { value: 'closing', label: 'Kapanıştan önce tamamla' },
    { value: 'optional', label: 'Opsiyonel' }
]);

const AUTHORING_FIELDS = Object.freeze({
    flexible: { mode: 'situational', requirement: 'preferred' },
    important: { mode: 'important', requirement: 'required_if_relevant' },
    closing: { mode: 'important', requirement: 'required_before_close' },
    optional: { mode: 'skip-if-no-answer', requirement: 'optional' }
});

export function importanceFromPlaybookNode(node = {}) {
    if (node.requirement === 'required_before_close') return 'closing';
    if (node.requirement === 'required_if_relevant') return 'important';
    if (node.requirement === 'preferred') return 'flexible';
    if (node.requirement === 'optional') return 'optional';
    // Legacy `important` is emphasis, never silently a mandatory closing.
    if (node.mode === 'important') return 'important';
    if (node.mode === 'skip-if-no-answer') return 'optional';
    return 'flexible';
}

export function authoringFieldsForImportance(importance) {
    return AUTHORING_FIELDS[importance] ?? AUTHORING_FIELDS.flexible;
}

export function importanceHelp(importance) {
    return {
        flexible: 'Müşterinin ilgisine ve sorularına göre yeri değişebilir.',
        important: 'Konu müşteri için uygunsa önceliklendirilir; konuşma zorlanmaz.',
        closing: 'Açık sorular bittikten sonra bu hedefe geri dönülür; ret halinde ısrar edilmez.',
        optional: 'Bağlam uygun değilse veya cevap alınamazsa atlanabilir.'
    }[importance] ?? '';
}

function objectiveText(node) {
    return node.type === 'survey' ? node.survey?.question || node.directive : node.directive;
}

/** Human-readable projection of compiled behavior; no runtime vocabulary. */
export function buildPlaybookBehaviorPreview(nodes = []) {
    return nodes.map((node, index) => {
        const importance = importanceFromPlaybookNode(node);
        const screenParts = [];
        if (node.url) screenParts.push('ilgili ürün sayfasını gösterir');
        if (node.actions?.filter(Boolean).length) {
            screenParts.push(`${node.actions.filter(Boolean).length} ekran etkileşimini sırayla uygular`);
        }
        return {
            id: node.id,
            position: index + 1,
            objective: objectiveText(node),
            importance,
            importanceLabel: PLAYBOOK_IMPORTANCE_OPTIONS.find((option) =>
                option.value === importance)?.label,
            behavior: importanceHelp(importance),
            screenBehavior: screenParts.join(' ve ') || null
        };
    });
}

export function summarizePlaybookAuthoring(nodes = []) {
    const preview = buildPlaybookBehaviorPreview(nodes);
    return {
        stepCount: preview.length,
        closingCount: preview.filter((item) => item.importance === 'closing').length,
        screenStepCount: preview.filter((item) => item.screenBehavior).length,
        surveyCount: nodes.filter((node) => node.type === 'survey').length
    };
}
