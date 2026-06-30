import { z } from 'zod';

/**
 * Validates `process.env` against a Zod schema and returns a typed, frozen config.
 * Throws a readable error at boot if required vars are missing.
 *
 * @template {z.ZodRawShape} T
 * @param {T} shape
 * @returns {Readonly<z.infer<z.ZodObject<T>>>}
 */
export function loadEnv(shape) {
    const schema = z.object(shape);
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n');
        throw new Error(`[config-env] Invalid environment variables:\n${issues}`);
    }
    return Object.freeze(parsed.data);
}

export const env = z;
