import { beforeEach, describe, expect, it, vi } from 'vitest';

const disk = { mtimeMs: 1, bundle: 'v1-bundle', version: '1.0.0', statError: null };

vi.mock('node:fs', () => ({
    statSync: () => {
        if (disk.statError) throw disk.statError;
        return { mtimeMs: disk.mtimeMs };
    },
    readFileSync: (path) => (String(path).endsWith('package.json') ? JSON.stringify({ version: disk.version }) : disk.bundle)
}));

vi.mock('@repo/logger', () => ({ Logger: { warn: vi.fn() } }));

let loadSdkBundle;

beforeEach(async () => {
    vi.resetModules();
    Object.assign(disk, { mtimeMs: 1, bundle: 'v1-bundle', version: '1.0.0', statError: null });
    ({ loadSdkBundle } = await import('./sdk-bundle.js'));
});

describe('loadSdkBundle', () => {
    it('serves a rebuilt bundle without an API restart', () => {
        expect(loadSdkBundle()).toMatchObject({ content: 'v1-bundle', version: '1.0.0' });

        Object.assign(disk, { mtimeMs: 2, bundle: 'v2-bundle', version: '1.1.0' });

        expect(loadSdkBundle()).toMatchObject({ content: 'v2-bundle', version: '1.1.0' });
    });

    it('reuses the cached bundle while the file is unchanged', () => {
        const first = loadSdkBundle();
        disk.bundle = 'changed-without-new-mtime';
        expect(loadSdkBundle()).toBe(first);
    });

    it('keeps serving the last good bundle if the file is briefly unreadable', () => {
        const first = loadSdkBundle();
        disk.statError = new Error('ENOENT');
        expect(loadSdkBundle()).toBe(first);
    });

    it('returns null before the bundle has ever been built', () => {
        disk.statError = new Error('ENOENT');
        expect(loadSdkBundle()).toBeNull();
    });
});
