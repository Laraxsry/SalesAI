import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

export const requestContext = new AsyncLocalStorage();

const isProd = process.env.NODE_ENV === 'production';

const base = pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
        paths: [
            'password',
            'token',
            'secret',
            'authorization',
            'apiKey',
            'api_key',
            '*.password',
            '*.token',
            '*.apiKey'
        ],
        censor: '***REDACTED***'
    },
    transport: isProd
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
});

/**
 * Returns a logger bound to the current async request context (requestId, etc).
 * @param {Record<string, unknown>} [bindings]
 */
export function getLogger(bindings = {}) {
    const store = requestContext.getStore();
    return base.child({ ...(store || {}), ...bindings });
}

/**
 * Runs `fn` within a logging context (e.g. per HTTP request).
 * @param {Record<string, unknown>} ctx
 * @param {() => unknown} fn
 */
export function runWithContext(ctx, fn) {
    return requestContext.run(ctx, fn);
}

export const Logger = base;
export default base;
