import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/sdk-bundle.js', () => ({
    loadSdkBundle: () => ({ content: 'window.SalesAI={};', version: '0.1.0' })
}));

const { sdkRouter } = await import('./sdk.js');

function serveBundle() {
    const route = sdkRouter.stack.find((layer) => layer.route?.path === '/salesai.js').route;
    const handler = route.stack.at(-1).handle;
    const headers = {};
    const res = {
        set: (name, value) => { headers[name] = value; },
        send: vi.fn()
    };
    handler({}, res);
    return { headers, res };
}

describe('GET /sdk/salesai.js', () => {
    it('allows cross-origin loading so the script runs on sellers\' sites despite helmet\'s same-origin CORP', () => {
        const { headers, res } = serveBundle();
        expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
        expect(res.send).toHaveBeenCalledWith('window.SalesAI={};');
    });
});
