import { defineConfig } from 'vitest/config';

/** Shared Vitest config for Node packages in the monorepo. */
export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.js', 'test/**/*.test.js']
    }
});
