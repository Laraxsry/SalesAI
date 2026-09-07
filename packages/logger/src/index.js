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

const LEVEL_METHODS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

function isPlainMetaObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error);
}

/**
 * Every call site in this repo is written `log.info('message', {meta})` —
 * readable, but backwards from pino's real signature,
 * `log.info(mergingObject, message)`. Called as written, pino treats the
 * string as `msg` and the trailing object as an unused printf-interpolation
 * arg: `{meta}` is silently dropped, never reaches the output. Rewriting
 * all 49+ existing call sites was flagged and deliberately deferred
 * (md/backend/playbook_session_log.md, 4.5 / open item 2) as a big,
 * mechanical, easy-to-botch-by-hand change. Swapping the two arguments here
 * instead — once, at the boundary — fixes every call site (present and
 * future) without touching any of them, for the exact two-argument
 * `(string, plainObject)` shape those call sites all share; anything else
 * (a single string, an already-correct `(obj, msg)` call, an Error) passes
 * through to pino untouched.
 */
function wrapLogger(target) {
    return new Proxy(target, {
        get(obj, prop, receiver) {
            if (prop === 'child') {
                return (...args) => wrapLogger(obj.child(...args));
            }
            if (LEVEL_METHODS.includes(prop) && typeof obj[prop] === 'function') {
                const original = obj[prop].bind(obj);
                return (...args) => {
                    if (args.length === 2 && typeof args[0] === 'string' && isPlainMetaObject(args[1])) {
                        return original(args[1], args[0]);
                    }
                    return original(...args);
                };
            }
            const value = Reflect.get(obj, prop, receiver);
            return typeof value === 'function' ? value.bind(obj) : value;
        }
    });
}

/**
 * Returns a logger bound to the current async request context (requestId, etc).
 * @param {Record<string, unknown>} [bindings]
 */
export function getLogger(bindings = {}) {
    const store = requestContext.getStore();
    return wrapLogger(base.child({ ...(store || {}), ...bindings }));
}

/**
 * Runs `fn` within a logging context (e.g. per HTTP request).
 * @param {Record<string, unknown>} ctx
 * @param {() => unknown} fn
 */
export function runWithContext(ctx, fn) {
    return requestContext.run(ctx, fn);
}

export const Logger = wrapLogger(base);
export default Logger;
