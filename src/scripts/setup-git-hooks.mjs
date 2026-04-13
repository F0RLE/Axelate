import { execFileSync } from 'node:child_process';
import {
    repoRoot,
    resolveGitExecutable as resolveSharedGitExecutable,
} from '../../.github/scripts/lib/tooling-paths.mjs';

const gitExecutable = resolveGitExecutable();

function resolveGitExecutable() {
    const executable = resolveSharedGitExecutable(repoRoot);
    if (executable) {
        return executable;
    }

    console.warn('[hooks] git executable not found; skipping hook setup');
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
