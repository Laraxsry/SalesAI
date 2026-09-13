const SUPPORTED_PROVIDERS = new Set(['playwright', 'stagehand', 'chrome-mcp']);

/**
 * Selects one browser backend for the whole session. Playbook activity is
 * reported for diagnostics but never changes the configured provider: URL
 * ownership is handled by the playbook runtime and command serialization by
 * BrowserSession.
 */
export function selectBrowserProvider({ configuredProvider = 'playwright', playbookActive = false } = {}) {
    const effectiveProvider = configuredProvider === 'browserbase'
        ? 'stagehand'
        : configuredProvider;
    if (!SUPPORTED_PROVIDERS.has(effectiveProvider)) {
        throw new Error(`Unsupported COBROWSE_PROVIDER: ${configuredProvider}`);
    }
    return {
        configuredProvider,
        effectiveProvider,
        fallbackReason: null,
        playbookActive
    };
}
