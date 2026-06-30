import js from '@eslint/js';
import globals from 'globals';

/**
 * Shared flat ESLint config for the SalesAI monorepo (ESLint 9).
 * @type {import('eslint').Linter.Config[]}
 */
export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'prefer-const': 'warn',
            eqeqeq: ['warn', 'always']
        }
    },
    {
        ignores: ['dist/**', 'build/**', '.next/**', 'node_modules/**']
    }
];
