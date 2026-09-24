const TEMPLATES = Object.freeze({
    'company.industry': {
        purpose: 'demo_routing', answerType: 'single_select',
        question: 'Hangi sektörde faaliyet gösteriyorsunuz?',
        options: [
            { value: 'finance', label: 'Finans' },
            { value: 'healthcare', label: 'Sağlık' },
            { value: 'retail', label: 'Perakende' },
            { value: 'technology', label: 'Teknoloji' },
            { value: 'other', label: 'Diğer' }
        ]
    },
    'company.team_size': {
        purpose: 'qualification', answerType: 'single_select',
        question: 'Ekibiniz yaklaşık kaç kişiden oluşuyor?',
        options: [
            { value: 'one_to_ten', label: '1–10' },
            { value: 'eleven_to_fifty', label: '11–50' },
            { value: 'fifty_one_to_two_hundred', label: '51–200' },
            { value: 'more_than_two_hundred', label: '200+' }
        ]
    },
    'customer.primary_goal': {
        purpose: 'demo_routing', answerType: 'short_text',
        question: 'Bu görüşmede öncelikle hangi sonucu görmek istersiniz?',
        options: []
    }
});

/** Conservative baseline: authored fields only, no customer transcript/model. */
export function createRulesShadowSurveyPlanner() {
    return {
        async propose({ field, routeRevision, epoch, turnIndex }) {
            const template = TEMPLATES[field?.key];
            if (!template || field.preferredInput !== template.answerType
                || !field.affects?.length) return null;
            return {
                proposalId: `shadow_${turnIndex}_${field.key}`,
                baseRevision: routeRevision, epoch,
                purpose: template.purpose, questionKey: field.key,
                question: template.question, reason: 'İzinli alan demo rotasını veya keşfi etkiler.',
                answerType: template.answerType,
                options: template.options,
                requiredFor: field.affects,
                blocking: false, confidenceThatUnknown: 1
            };
        }
    };
}
