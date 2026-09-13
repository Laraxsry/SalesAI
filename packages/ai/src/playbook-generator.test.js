import { describe, expect, it, vi } from 'vitest';
import { compileGeneratedPlaybook, generatePlaybookDraft } from './playbook-generator.js';

const context = {
    product: { name: 'GelirGider', description: 'ABD borsa vergisi hesaplama' },
    agent: { persona: { language: 'tr', tone: 'natural', goals: ['ürünü anlat'] } },
    topics: [{ title: 'Ekstre Yükleme', body: 'Midas ve Papara PDF ekstreleri yüklenir.' }],
    siteMap: [
        { url: 'https://gelirgider.example/', title: 'Ana sayfa' },
        {
            url: 'https://gelirgider.example/faq',
            title: 'SSS',
            clickableElements: ['Döviz kuru nasıl hesaplanıyor?']
        }
    ],
    canUseSurvey: true
};

describe('compileGeneratedPlaybook', () => {
    it('sanitizes model output and preserves only exact allowlisted URLs', () => {
        const result = compileGeneratedPlaybook({
            nodes: [
                {
                    type: 'survey',
                    question: 'Hangi aracı kurumu kullanıyorsunuz?',
                    options: ['Midas', 'Papara', 'Midas'],
                    mode: 'important'
                },
                {
                    type: 'narrative',
                    directive: 'Ekstre yükleme akışını ihtiyaca bağlayarak göster.',
                    url: 'https://gelirgider.example/faq',
                    actions: ['Döviz kuru nasıl hesaplanıyor?']
                },
                {
                    type: 'narrative',
                    directive: 'Güvensiz adrese gitme.',
                    url: 'https://attacker.example/'
                }
            ]
        }, {
            allowedUrls: ['https://gelirgider.example/faq'],
            allowedAttachments: {
                'https://gelirgider.example/faq': ['Döviz kuru nasıl hesaplanıyor?']
            },
            canUseSurvey: true,
            maxNodes: 6
        });

        expect(result.nodes).toHaveLength(3);
        expect(result.nodes[0].survey.options).toEqual([
            { value: 'generated_option_1', label: 'Midas' },
            { value: 'generated_option_2', label: 'Papara' }
        ]);
        expect(result.nodes[1].url).toBe('https://gelirgider.example/faq');
        expect(result.nodes[1].actions).toEqual(['Döviz kuru nasıl hesaplanıyor?']);
        expect(result.nodes[2].url).toBeNull();
    });

    it('drops an invented click target that was not observed on the selected page, keeping the valid ones', () => {
        const result = compileGeneratedPlaybook({ nodes: [{
            type: 'narrative',
            directive: 'İlgili SSS maddesini göster.',
            url: 'https://gelirgider.example/faq',
            actions: ['Döviz kuru nasıl hesaplanıyor?', 'Vergilerinizi kolaylaştırmak için buradayız.']
        }] }, {
            allowedUrls: ['https://gelirgider.example/faq'],
            allowedAttachments: {
                'https://gelirgider.example/faq': ['Döviz kuru nasıl hesaplanıyor?']
            }
        });
        expect(result.nodes[0].actions).toEqual(['Döviz kuru nasıl hesaplanıyor?']);
    });

    it('accepts the legacy single `attach` string shape as a one-item actions list', () => {
        const result = compileGeneratedPlaybook({ nodes: [{
            type: 'narrative',
            directive: 'İlgili SSS maddesini göster.',
            url: 'https://gelirgider.example/faq',
            attach: 'Döviz kuru nasıl hesaplanıyor?'
        }] }, {
            allowedUrls: ['https://gelirgider.example/faq'],
            allowedAttachments: {
                'https://gelirgider.example/faq': ['Döviz kuru nasıl hesaplanıyor?']
            }
        });
        expect(result.nodes[0].actions).toEqual(['Döviz kuru nasıl hesaplanıyor?']);
    });

    it('drops survey nodes for group agents and rejects an empty result', () => {
        expect(() => compileGeneratedPlaybook({
            nodes: [{ type: 'survey', question: 'Rolünüz?', answerType: 'text' }]
        }, { canUseSurvey: false })).toThrow(/valid step/);
    });

    it('downgrades an underspecified single-choice survey to safe text input', () => {
        const result = compileGeneratedPlaybook({
            nodes: [
                { type: 'survey', question: 'Önceliğiniz?', options: ['Hız'] },
                { type: 'narrative', directive: 'Cevabı ürün değerine bağla.' }
            ]
        });

        expect(result.nodes[0].survey).toMatchObject({ answerType: 'text', options: [], allowFreeText: true });
    });

    it('preserves valid field keys and drops invalid AI metadata without losing the draft', () => {
        const result = compileGeneratedPlaybook({
            nodes: [
                {
                    type: 'survey',
                    question: 'Önceliğiniz?',
                    answerType: 'text',
                    fieldKey: 'qualification.priority'
                },
                {
                    type: 'survey',
                    question: 'Ek notunuz?',
                    answerType: 'text',
                    fieldKey: 'müşteri.öncelik'
                },
                { type: 'narrative', directive: 'Cevapları ürün değerine bağla.' }
            ]
        });

        expect(result.nodes[0].survey.fieldKey).toBe('qualification.priority');
        expect(result.nodes[1].survey.fieldKey).toBeNull();
        expect(result.nodes[2].directive).toBe('Cevapları ürün değerine bağla.');
    });
});

describe('generatePlaybookDraft', () => {
    it('builds presets without calling an LLM and returns a reviewable draft', async () => {
        const llm = { complete: vi.fn() };

        const result = await generatePlaybookDraft({
            source: 'preset',
            preset: 'guided-demo',
            includeSurvey: true,
            maxNodes: 6,
            brief: '',
            strategy: 'consultative'
        }, context, { llm });

        expect(llm.complete).not.toHaveBeenCalled();
        expect(result.generatedBy).toBe('preset');
        expect(result.nodes.some((node) => node.type === 'survey')).toBe(true);
        expect(result.nodes.some((node) => node.url === 'https://gelirgider.example/')).toBe(true);
    });

    it('grounds the LLM prompt in company knowledge and compiles its response', async () => {
        const llm = {
            complete: vi.fn().mockResolvedValue({
                text: '```json\n{"nodes":[{"type":"narrative","directive":"Doğrulanmış ekstre akışını anlat.","url":"https://gelirgider.example/faq"}]}\n```'
            })
        };

        const result = await generatePlaybookDraft({
            source: 'ai',
            preset: null,
            includeSurvey: false,
            maxNodes: 5,
            brief: 'Midas kullanıcılarına odaklan',
            strategy: 'sector-aware'
        }, context, { llm });

        expect(result.generatedBy).toBe('ai');
        expect(result.nodes[0].url).toBe('https://gelirgider.example/faq');
        const prompt = llm.complete.mock.calls[0][0].system;
        expect(prompt).toContain('Ekstre Yükleme');
        expect(prompt).toContain('sector-aware');
        expect(prompt).toContain('Midas kullanıcılarına odaklan');
        expect(prompt).toContain('never invent');
        expect(prompt).toContain('Döviz kuru nasıl hesaplanıyor?');
    });
});
