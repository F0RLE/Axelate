import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(scriptDir, '..');
const repoRoot = resolve(srcDir, '..');
const gitExecutable = resolveGitExecutable();

function resolveGitExecutable() {
    const candidates =
        process.platform === 'win32'
            ? [
                  'C:\\Program Files\\Git\\cmd\\git.exe',
                  'C:\\Program Files\\Git\\bin\\git.exe',
                  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
                  'C:\\Program Files (x86)\\Git\\bin\\git.exe',
              ]
            : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];

    const executable = candidates.find((candidate) => existsSync(candidate));
    if (executable !== undefined) {
        return executable;
    }

    console.warn('[hooks] git executable not found in fixed locations; skipping hook setup');
    process.exit(0);
}

function runGit(...args) {
    return execFileSync(gitExecutable, args, {
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
