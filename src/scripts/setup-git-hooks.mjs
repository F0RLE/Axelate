import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(scriptDir, '..');
const repoRoot = resolve(srcDir, '..');
const gitExecutable = resolveGitExecutable();

function resolveGitExecutable() {
    const configuredGit = process.env.GIT ?? process.env.AXELATE_GIT;
    if (configuredGit && existsSync(configuredGit)) {
        return configuredGit;
    }

    try {
        execFileSync('git', ['--version'], {
            cwd: repoRoot,
            stdio: 'ignore',
        });
        return 'git';
    } catch {
        // Fall back to well-known install locations below.
    }

    const candidates =
        process.platform === 'win32'
            ? [
                  String.raw`C:\Program Files\Microsoft Visual Studio\18\Insiders\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe`,
                  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe`,
                  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe`,
                  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe`,
                  String.raw`C:\Program Files\Git\cmd\git.exe`,
                  String.raw`C:\Program Files\Git\bin\git.exe`,
                  String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
                  String.raw`C:\Program Files (x86)\Git\bin\git.exe`,
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
