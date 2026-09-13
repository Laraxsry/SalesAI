import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const chromeMcpPackagePath = require.resolve('chrome-devtools-mcp/package.json');
const chromeMcpBin = join(dirname(chromeMcpPackagePath), 'build/src/bin/chrome-devtools-mcp.js');

const DEFAULT_ALLOWED_TOOLS = new Set([
    'click',
    'drag',
    'fill',
    'fill_form',
    'handle_dialog',
    'hover',
    'press_key',
    'type_text',
    'close_page',
    'list_pages',
    'navigate_page',
    'new_page',
    'select_page',
    'wait_for',
    'take_snapshot',
    'take_screenshot'
]);

const INTERNAL_ALLOWED_TOOLS = new Set(['evaluate_script']);

/** Thin infrastructure adapter. It contains no sales or site-specific logic. */
export class ChromeMcpAdapter {
    constructor({
        browserUrl,
        command = process.execPath,
        commandArgs = [chromeMcpBin],
        launchBrowser = false,
        executablePath,
        viewport = { width: 1280, height: 720 },
        timeoutMs = 15_000,
        allowedTools = DEFAULT_ALLOWED_TOOLS,
        clientFactory,
        transportFactory
    } = {}) {
        if (!browserUrl && !launchBrowser) {
            throw new TypeError('ChromeMcpAdapter requires browserUrl or launchBrowser=true.');
        }
        this.browserUrl = browserUrl;
        this.launchBrowser = launchBrowser;
        this.executablePath = executablePath;
        this.viewport = viewport;
        this.command = command;
        this.commandArgs = commandArgs;
        this.timeoutMs = timeoutMs;
        this.allowedTools = new Set(allowedTools);
        this.clientFactory = clientFactory ?? (() => new Client({ name: 'salesai-browser', version: '0.1.0' }));
        this.transportFactory = transportFactory ?? ((params) => new StdioClientTransport(params));
        this.client = null;
        this.transport = null;
        this.tools = new Map();
        this.internalTools = new Map();
        this.connectPromise = null;
    }

    async connect() {
        if (this.client) return this;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = (async () => {
            const client = this.clientFactory();
            const transport = this.transportFactory({
                command: this.command,
                args: [
                    ...this.commandArgs,
                    ...(this.browserUrl
                        ? [`--browser-url=${this.browserUrl}`]
                        : [
                            '--headless',
                            '--isolated',
                            `--viewport=${this.viewport.width}x${this.viewport.height}`,
                            ...(this.executablePath ? [`--executable-path=${this.executablePath}`] : [])
                        ]),
                    '--no-usage-statistics',
                    '--no-performance-crux'
                ],
                stderr: 'inherit'
            });

            try {
                await client.connect(transport, { timeout: this.timeoutMs });
                const result = await client.listTools(undefined, { timeout: this.timeoutMs });
                this.tools = new Map(
                    result.tools
                        .filter((tool) => this.allowedTools.has(tool.name))
                        .map((tool) => [tool.name, tool])
                );
                this.internalTools = new Map(
                    result.tools
                        .filter((tool) => INTERNAL_ALLOWED_TOOLS.has(tool.name))
                        .map((tool) => [tool.name, tool])
                );
                this.client = client;
                this.transport = transport;
                return this;
            } catch (error) {
                await transport.close?.().catch(() => {});
                throw error;
            }
        })();

        try {
            return await this.connectPromise;
        } finally {
            this.connectPromise = null;
        }
    }

    listTools() {
        return [...this.tools.values()];
    }

    async callTool(name, args = {}) {
        await this.connect();
        if (!this.tools.has(name)) {
            throw new Error(`Chrome MCP tool is unavailable or not allowed: ${name}`);
        }

        // Use the SDK timeout so MCP cancellation is propagated to the server.
        // A local Promise.race would let the browser action continue after the
        // session believed it had stopped, violating the single-writer rule.
        const result = await this.client.callTool(
            { name, arguments: args },
            undefined,
            { timeout: this.timeoutMs }
        );
        return {
            ok: result.isError !== true,
            isError: result.isError === true,
            content: result.content ?? [],
            ...(result.structuredContent && { structuredContent: result.structuredContent })
        };
    }

    async callInternalTool(name, args = {}) {
        await this.connect();
        if (!this.internalTools.has(name)) {
            throw new Error(`Chrome MCP internal tool is unavailable or not allowed: ${name}`);
        }
        const result = await this.client.callTool(
            { name, arguments: args },
            undefined,
            { timeout: this.timeoutMs }
        );
        return {
            ok: result.isError !== true,
            isError: result.isError === true,
            content: result.content ?? [],
            ...(result.structuredContent && { structuredContent: result.structuredContent })
        };
    }

    async close() {
        const client = this.client;
        const transport = this.transport;
        this.client = null;
        this.transport = null;
        this.tools.clear();
        this.internalTools.clear();
        await client?.close?.().catch(() => transport?.close?.());
        if (!client) await transport?.close?.();
    }
}

export { DEFAULT_ALLOWED_TOOLS, INTERNAL_ALLOWED_TOOLS };
