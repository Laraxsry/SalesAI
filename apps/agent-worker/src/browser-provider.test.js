import { describe, expect, it } from 'vitest';
import { selectBrowserProvider } from './browser-provider.js';

describe('selectBrowserProvider', () => {
    it('keeps Chrome MCP active when a playbook is present', () => {
        expect(selectBrowserProvider({
            configuredProvider: 'chrome-mcp',
            playbookActive: true
        })).toEqual({
            configuredProvider: 'chrome-mcp',
            effectiveProvider: 'chrome-mcp',
            fallbackReason: null,
            playbookActive: true
        });
    });

    it('keeps the legacy Browserbase alias for Stagehand', () => {
        expect(selectBrowserProvider({ configuredProvider: 'browserbase' }).effectiveProvider)
            .toBe('stagehand');
    });

    it('rejects an unsupported provider', () => {
        expect(() => selectBrowserProvider({ configuredProvider: 'unknown' }))
            .toThrow('Unsupported COBROWSE_PROVIDER: unknown');
    });
});
