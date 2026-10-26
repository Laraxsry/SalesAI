import { beforeEach, describe, expect, it, vi } from 'vitest';

const complete = vi.fn();

vi.mock('./llm/index.js', () => ({
    getLLM: () => ({ complete })
}));

const { dedupeProposedTopics } = await import('./site-topics.js');

describe('dedupeProposedTopics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('collects every proposal under one safe topic when clustering fails', async () => {
        complete.mockRejectedValue(new Error('RequestTimeout'));

        const result = await dedupeProposedTopics(
            [{ proposedTopic: 'Integrations' }, { proposedTopic: 'Templates' }, { proposedTopic: 'Security' }],
            'English'
        );

        expect(result).toEqual([
            { index: 0, slug: 'other-site-information', title: 'Other Site Information' },
            { index: 1, slug: 'other-site-information', title: 'Other Site Information' },
            { index: 2, slug: 'other-site-information', title: 'Other Site Information' }
        ]);
    });

    it('collects indexes omitted by a partial model response without creating one topic per omission', async () => {
        complete.mockResolvedValue({
            text: JSON.stringify({ groups: [{ indexes: [0], title: 'Integrations' }] })
        });

        const result = await dedupeProposedTopics(
            [{ proposedTopic: 'Integrations' }, { proposedTopic: 'Templates' }, { proposedTopic: 'Security' }],
            'English'
        );

        expect(result).toEqual([
            { index: 0, slug: 'integrations', title: 'Integrations' },
            { index: 1, slug: 'other-site-information', title: 'Other Site Information' },
            { index: 2, slug: 'other-site-information', title: 'Other Site Information' }
        ]);
    });
});
