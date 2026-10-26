import { beforeEach, describe, expect, it, vi } from 'vitest';

const Procedure = { findOneAndUpdate: vi.fn(), updateOne: vi.fn() };
vi.mock('@repo/database', () => ({ Procedure }));
vi.mock('@repo/ai', () => ({ embedBatch: vi.fn(async (chunks) => chunks.map(() => [0.1, 0.2])) }));

const store = { deleteByIds: vi.fn(), upsert: vi.fn() };
vi.mock('./stores/index.js', () => ({ getVectorStore: () => store }));

const invalidateProductCache = vi.fn();
vi.mock('./retrieve.js', () => ({ invalidateProductCache: (...args) => invalidateProductCache(...args) }));

const { saveProcedure } = await import('./procedure-store.js');
const { buildProcedure } = await import('./procedure.js');

const learned = () => ({
    trigger: 'New variable',
    listUrl: 'https://app.example/project/6ab4ff6b5f3621fac23249f1/cms/variable',
    applied: true,
    steps: [
        { action: 'press', where: 'page', label: 'New variable' },
        { action: 'fill', label: 'Name', type: 'text', value: 'salesai-demo-x-name', ok: true },
        { action: 'press', where: 'form', label: 'Create variable' }
    ],
    form: { fields: [{ label: 'Name', type: 'text', required: true }], actions: [{ label: 'Cancel' }, { label: 'Create variable' }] },
    commit: { label: 'Create variable' },
    attempts: [],
    outcome: { status: 'created', notices: [], errors: [] },
    deleteFlow: { steps: [{ action: 'press', where: 'row', label: '(icon button)' }, { action: 'press', where: 'menu', label: 'Delete' }] }
});
const procedure = () => buildProcedure(learned()).procedure;

beforeEach(() => {
    vi.clearAllMocks();
    Procedure.findOneAndUpdate.mockResolvedValue({ _id: 'proc-1', chunkIds: [] });
    store.upsert.mockImplementation(async (items) => items.map((_, index) => `chunk-${index + 1}`));
});

describe('saveProcedure', () => {
    it('stores the record and files the recipe on the dashboard shelf, pointing back at the record', async () => {
        const result = await saveProcedure({ procedure: procedure(), productId: 'prod-1', sourceId: 'src-1' });

        const [filter, update] = Procedure.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ productId: 'prod-1', slug: 'cms-variable--new-variable' });
        expect(update.$set).toMatchObject({ sourceId: 'src-1', status: 'active', descriptionSource: 'template', trigger: 'New variable' });

        const [items] = store.upsert.mock.calls[0];
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            productId: 'prod-1',
            sourceId: 'src-1',
            kind: 'ui',
            metadata: { procedureId: 'proc-1', procedure: 'cms-variable--new-variable', trigger: 'New variable' }
        });
        expect(items[0].text).toContain('Press "New variable"');
        expect(Procedure.updateOne).toHaveBeenCalledWith({ _id: 'proc-1' }, { $set: { chunkIds: ['chunk-1'] } });
        expect(invalidateProductCache).toHaveBeenCalledWith('prod-1');
        expect(result).toEqual({ procedureId: 'proc-1', chunks: 1, descriptionSource: 'template' });
    });

    // Re-learning a flow after the dashboard changed must not leave the old wording retrievable next to the new.
    it('replaces the chunks of an earlier version instead of adding to them', async () => {
        Procedure.findOneAndUpdate.mockResolvedValue({ _id: 'proc-1', chunkIds: ['old-1', 'old-2'] });

        await saveProcedure({ procedure: procedure(), productId: 'prod-1', sourceId: 'src-1' });

        expect(store.deleteByIds).toHaveBeenCalledWith(['old-1', 'old-2']);
        expect(store.deleteByIds.mock.invocationCallOrder[0]).toBeLessThan(store.upsert.mock.invocationCallOrder[0]);
    });

    it('does not touch the store when there is nothing to delete', async () => {
        await saveProcedure({ procedure: procedure(), productId: 'prod-1', sourceId: 'src-1' });

        expect(store.deleteByIds).not.toHaveBeenCalled();
    });

    it('puts a written description first, and records that it came from the model', async () => {
        const describe = vi.fn(async () => 'Variables keep values the agent remembers.');

        const result = await saveProcedure({ procedure: procedure(), productId: 'prod-1', sourceId: 'src-1', describe });

        expect(describe).toHaveBeenCalledWith(expect.objectContaining({ language: 'English', procedureText: expect.stringContaining('Press "New variable"') }));
        // The chunker folds line breaks into spaces; what matters is that the description comes before the steps.
        const embedded = store.upsert.mock.calls[0][0][0].text;
        expect(embedded).toContain('Variables keep values the agent remembers.');
        expect(embedded.indexOf('Variables keep values')).toBeLessThan(embedded.indexOf('1. Open the page'));
        expect(Procedure.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ description: 'Variables keep values the agent remembers.', descriptionSource: 'llm' });
        expect(result.descriptionSource).toBe('llm');
    });

    it('asks for a Turkish description for a Turkish recipe', async () => {
        const describe = vi.fn(async () => '');
        const turkish = buildProcedure(learned(), { language: 'tr' }).procedure;

        await saveProcedure({ procedure: turkish, productId: 'prod-1', sourceId: 'src-1', describe });

        expect(describe.mock.calls[0][0].language).toBe('Turkish');
    });

    it('keeps the template wording when the description fails, instead of failing the save', async () => {
        const describe = vi.fn(async () => { throw new Error('rate limited'); });

        const result = await saveProcedure({ procedure: procedure(), productId: 'prod-1', sourceId: 'src-1', describe });

        expect(result.descriptionSource).toBe('template');
        expect(store.upsert).toHaveBeenCalled();
    });
});
