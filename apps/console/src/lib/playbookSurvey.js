/** Maps persisted/generated survey data into the editor state shape.
 * Option placeholders remain a UI concern supplied by the caller; semantic
 * metadata is copied here so every load/apply/save-refresh path is identical. */
export function toEditorSurvey(survey, options) {
    return {
        question: survey.question || '',
        fieldKey: survey.fieldKey || null,
        answerType: survey.answerType || 'single-choice',
        options,
        allowFreeText: Boolean(survey.allowFreeText),
        required: survey.required !== false
    };
}
