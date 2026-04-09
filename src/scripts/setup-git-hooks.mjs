import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(scriptDir, '..');
const repoRoot = resolve(srcDir, '..');

function runGit(...args) {
    return execFileSync('git', args, {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    }).trim();
}

try {
    runGit('rev-parse', '--is-inside-work-tree');
} catch {
    process.exit(0);
}

const hooksPath = '.github/.husky';
const currentHooksPath = (() => {
    try {
        return runGit('config', '--get', 'core.hooksPath');
    } catch {
        return '';
    }
})();

if (currentHooksPath !== hooksPath) {
    runGit('config', 'core.hooksPath', hooksPath);
    console.log(`[hooks] core.hooksPath -> ${hooksPath}`);
}
