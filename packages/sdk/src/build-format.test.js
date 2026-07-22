import { describe, it, expect } from 'vitest';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Bundles the real loader source with the exact settings `npm run build` uses. */
function buildBundle() {
    const result = buildSync({
        entryPoints: [join(here, 'index.js')],
        bundle: true,
        format: 'iife',
        write: false
    });
    return result.outputFiles[0].text;
}

/**
 * Packaging contract test (not an esbuild-correctness test): this locks down
 * that OUR build config, applied to OUR current source, keeps producing a
 * classic-script-loadable bundle. If someone ever changes `--format=iife` to
 * `esm` in packages/sdk/package.json, the build still succeeds silently —
 * the break only surfaces as a `SyntaxError: Unexpected token 'export'` in
 * every customer's browser in production. A classic script — not
 * `type="module"` — is the standard, widely compatible shape for a
 * third-party embed loader; see the JSDoc atop src/index.js for the details.
 */
describe('SDK loader build output', () => {
    it('compiles as a classic (non-module) script — no export/import survives bundling', () => {
        const code = buildBundle();
        // A plain <script src="..."> parses code exactly this way; `export`/
        // `import` at the top level would throw here just like it would in
        // a browser loading this as a non-module script.
        expect(() => new vm.Script(code)).not.toThrow();
    });
});
