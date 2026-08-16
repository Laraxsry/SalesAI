/**
 * Runs every script under backend_tests/unit/ and backend_tests/integration/
 * — discovery is glob-based (any .mjs/.js dropped into either folder is
 * picked up automatically), so adding one new test file runs the whole
 * suite without touching a registry anywhere.
 *
 * Usage:
 *   node backend_tests/run-all.mjs             # unit + integration
 *   node backend_tests/run-all.mjs unit        # unit only (no live infra needed)
 *   node backend_tests/run-all.mjs integration # integration only (needs infra:up + API running)
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function collect(group) {
    const dir = path.join(__dirname, group);
    return readdirSync(dir)
        .filter((f) => /\.(mjs|js)$/.test(f))
        .sort()
        .map((f) => path.join(dir, f));
}

const requested = process.argv[2]; // undefined | 'unit' | 'integration'
const groups = requested ? [requested] : ['unit', 'integration'];

let totalFailed = 0;
let totalRun = 0;

for (const group of groups) {
    const files = collect(group);
    console.log(`\n\x1b[1m=== ${group.toUpperCase()} (${files.length} dosya) ===\x1b[0m`);

    for (const file of files) {
        totalRun++;
        console.log(`\n\x1b[36m-- ${path.relative(__dirname, file)} --\x1b[0m`);
        const res = spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        if (res.status !== 0) {
            totalFailed++;
            console.error(`\x1b[31mFAILED: ${path.relative(__dirname, file)}\x1b[0m`);
        }
    }
}

console.log(`\n\x1b[1m${totalRun} dosya çalıştı, ${totalFailed} başarısız.\x1b[0m`);
if (totalFailed > 0) process.exit(1);
