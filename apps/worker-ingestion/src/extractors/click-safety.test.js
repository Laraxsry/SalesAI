import { describe, it, expect } from 'vitest';
import { isSafeToClick, isSafeNavClick, isSafeToPeek, labelShape, looksLikePrompt, MAX_LABEL_CHARS } from './click-safety.js';

describe('isSafeToClick', () => {
    it('allows short, ordinary menu labels', () => {
        for (const label of ['Playbooks', 'Knowledge base', 'Analytics', 'Ürünler']) {
            expect(isSafeToClick(label)).toBe(true);
        }
    });

    it('rejects empty, over-long and side-effect labels', () => {
        expect(isSafeToClick('')).toBe(false);
        expect(isSafeToClick('x'.repeat(MAX_LABEL_CHARS + 1))).toBe(false);
        for (const label of ['Call', 'Sign up', 'Delete', 'Demo talep et', 'Download PDF']) {
            expect(isSafeToClick(label)).toBe(false);
        }
    });

    it('does not apply the panel-only words to ordinary labels', () => {
        // FAQ/tab labels must keep working for toggle and tab discovery.
        expect(isSafeToClick('How do I run a report?', { maxChars: 80 })).toBe(true);
    });
});

describe('isSafeNavClick', () => {
    it('also rejects logged-in panel actions', () => {
        for (const label of ['Publish', 'Run', 'Upgrade', 'Remove member', 'Deploy', 'Yayınla']) {
            expect(isSafeNavClick(label)).toBe(false);
        }
    });

    it('still allows panel navigation items', () => {
        for (const label of ['Agent', 'Workflows', 'Tools', 'Transcripts', 'Evaluations']) {
            expect(isSafeNavClick(label)).toBe(true);
        }
    });
});

// Labels below are the real ones from a crawl of a logged-in panel (Voiceflow demo workspace).
describe('isSafeToPeek', () => {
    it('presses ordinary page buttons that only reveal something', () => {
        for (const label of ['Edit view', 'Manage properties', 'Close panel', 'Edit mode: Auto', 'Effort level: Low', 'Next question', 'Voiceflow Core 4.2']) {
            expect(isSafeToPeek(label), label).toBe(true);
        }
    });

    // The crawl pressed these and each one created a record in the demo account, which it then crawled into.
    it('does not press buttons that create something', () => {
        for (const label of ['Create playbook', 'Create workflow', 'New test', 'New variable', 'New secret', 'Add data source', 'Create new number', 'New project', 'Yeni ekle', 'Oluştur']) {
            expect(isSafeToPeek(label), label).toBe(false);
        }
    });

    it('does not mistake words that merely contain a creation word', () => {
        for (const label of ['Newsletter', 'Address book', 'Added by me', 'Renewal', 'Knowledge']) {
            expect(isSafeToPeek(label), label).toBe(true);
        }
    });

    it('can press creation buttons when the run cleans up after itself', () => {
        expect(isSafeToPeek('Create playbook', { allowCreate: true })).toBe(true);
    });

    // The crawl pressed these and each one sent a real prompt to the account's AI assistant (billed credits).
    it('does not press suggested AI prompts', () => {
        for (const label of [
            'Which tools fail most often?',
            'Add a tool my agent is missing',
            'Explain what each of my tools does',
            'Write a test for my most common request',
            'Review this workflow for dead ends',
            'Find variables that are never set'
        ]) {
            expect(isSafeToPeek(label), label).toBe(false);
        }
    });

    it('never presses panel actions even with allowCreate', () => {
        for (const label of ['Publish', 'Run', 'Upgrade']) {
            expect(isSafeToPeek(label, { allowCreate: true }), label).toBe(false);
        }
    });
});

describe('looksLikePrompt', () => {
    it('flags questions and sentence-length text, not short labels', () => {
        expect(looksLikePrompt('Why?')).toBe(true);
        expect(looksLikePrompt('Summarise my last five conversations please')).toBe(true);
        expect(looksLikePrompt('Manage properties')).toBe(false);
        expect(looksLikePrompt('Edit mode: Auto')).toBe(false);
    });
});

describe('labelShape', () => {
    it('gives the same shape to buttons that differ only by a number or a date', () => {
        expect(labelShape('Sep 22')).toBe(labelShape('Oct 3'));
        expect(labelShape('Page 2')).toBe(labelShape('Page 10'));
        expect(labelShape('Ocak 5')).toBe(labelShape('Mart 17'));
    });

    it('keeps different buttons apart', () => {
        expect(labelShape('Edit view')).not.toBe(labelShape('Manage properties'));
        expect(labelShape('Page 2')).not.toBe(labelShape('Sep 22'));
    });
});
