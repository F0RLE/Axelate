import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(moduleDir, '..');

export const repoRoot = path.resolve(scriptsDir, '..', '..');
export const srcDir = path.join(repoRoot, 'src');
export const tauriDir = path.join(repoRoot, 'src-tauri');
export const releaseLikeTauriConfig = path.join(tauriDir, 'tauri.release-like.conf.json');
export const isWindows = process.platform === 'win32';
export const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
export const windowsWhereExecutable = path.join(systemRoot, 'System32', 'where.exe');
export const windowsCmdExecutable = path.join(systemRoot, 'System32', 'cmd.exe');

function currentPathKey(env) {
    return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

export function prependPathEntries(env, entries) {
    const pathKey = currentPathKey(env);
    const existing = String(env[pathKey] ?? '')
        .split(path.delimiter)
        .filter(Boolean);
    const normalized = new Set(existing.map((entry) => (isWindows ? entry.toLowerCase() : entry)));

    for (const entry of entries) {
        if (!entry || !existsSync(entry)) {
            continue;
        }

        const normalizedEntry = isWindows ? entry.toLowerCase() : entry;
        if (normalized.has(normalizedEntry)) {
            continue;
        }

        existing.unshift(entry);
        normalized.add(normalizedEntry);
    }

    env[pathKey] = existing.join(path.delimiter);
    env.PATH = env[pathKey];
}

export function resolveDepsDir(root = repoRoot) {
    const candidates = [
        process.env.AXELATE_DEPS_DIR,
        path.join(root, '.deps'),
        path.join(os.homedir(), 'Axelate-deps'),
    ].filter(Boolean);

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findExisting(candidates) {
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function resolveGitExecutable(root = repoRoot) {
    const configuredGit = process.env.GIT ?? process.env.AXELATE_GIT;
    if (configuredGit && existsSync(configuredGit)) {
        return configuredGit;
    }

    const candidates = isWindows
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
    const fixedGit = findExisting(candidates);
    if (fixedGit) {
        return fixedGit;
    }

    const result = spawnSync('git', ['--version'], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore'],
    });

    return result.status === 0 ? 'git' : null;
}

export function commandExists(command, env) {
    const lookup = isWindows ? windowsWhereExecutable : 'which';
    const result = spawnSync(lookup, [command], {
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
    });

    return result.status === 0;
}

export function resolveCommand(command, env) {
    if (!isWindows || path.isAbsolute(command) || command.includes(path.sep)) {
        return command;
    }

    const result = spawnSync(windowsWhereExecutable, [command], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
    });

    if (result.status !== 0 || !result.stdout) {
        return command;
    }

    const matches = result.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);

    if (matches.length === 0) {
        return command;
    }

    const preferredExtensions = ['.exe', '.com', '.cmd', '.bat'];
    for (const extension of preferredExtensions) {
        const match = matches.find((candidate) => candidate.toLowerCase().endsWith(extension));
        if (match) {
            return match;
        }
    }

    return matches[0];
}

function quoteForCmd(value) {
    if (value.length === 0) {
        return '""';
    }

    if (!/[ \t"&()^[\]{}=;!'+,`~]/u.test(value)) {
        return value;
    }

    return `"${value.replaceAll('"', '""')}"`;
}

export function buildCommandInvocation(command, args, env) {
    const executable = resolveCommand(command, env);
    const extension = path.extname(executable).toLowerCase();

    if (isWindows && (extension === '.cmd' || extension === '.bat')) {
        const commandLine = [executable, ...args].map(quoteForCmd).join(' ');
        return {
            command: windowsCmdExecutable,
            args: ['/d', '/s', '/c', commandLine],
        };
    }

    return {
        command: executable,
        args,
    };
}

function findVsDevCmd() {
    if (!isWindows) {
        return null;
    }

    const candidates = [];
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const vswhere =
        programFilesX86 === undefined
            ? null
            : path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

    if (vswhere && existsSync(vswhere)) {
        const result = spawnSync(
            vswhere,
            [
                '-latest',
                '-products',
                '*',
                '-requires',
                'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                '-property',
                'installationPath',
            ],
            {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            },
        );

        const installPath = result.stdout?.trim();
        if (result.status === 0 && installPath) {
            candidates.push(path.join(installPath, 'Common7', 'Tools', 'VsDevCmd.bat'));
        }
    }

    candidates.push(
        path.join(
            'C:',
            'Program Files',
            'Microsoft Visual Studio',
            '18',
            'Insiders',
            'Common7',
            'Tools',
            'VsDevCmd.bat',
        ),
        path.join(
            'C:',
            'Program Files',
            'Microsoft Visual Studio',
            '2022',
            'BuildTools',
            'Common7',
            'Tools',
            'VsDevCmd.bat',
        ),
        path.join(
            'C:',
            'Program Files',
            'Microsoft Visual Studio',
            '2022',
            'Community',
            'Common7',
            'Tools',
            'VsDevCmd.bat',
        ),
        path.join(
            'C:',
            'Program Files',
            'Microsoft Visual Studio',
            '2022',
            'Professional',
            'Common7',
            'Tools',
            'VsDevCmd.bat',
        ),
        path.join(
            'C:',
            'Program Files',
            'Microsoft Visual Studio',
            '2022',
            'Enterprise',
            'Common7',
            'Tools',
            'VsDevCmd.bat',
        ),
    );

    return findExisting(candidates);
}

function withMsvcEnvironment(env) {
    if (!isWindows || commandExists('cl.exe', env)) {
        return env;
    }

    const vsDevCmd = findVsDevCmd();
    if (!vsDevCmd) {
        return env;
    }

    const escapedVsDevCmd = vsDevCmd.replaceAll("'", "''");
    const command = [
        `$vsDevCmd = '${escapedVsDevCmd}'`,
        '& cmd.exe /d /s /c "call `"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"',
    ].join('; ');
    const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        {
            encoding: 'utf8',
            env,
            stdio: ['ignore', 'pipe', 'ignore'],
        },
    );

    if (result.status !== 0 || !result.stdout) {
        return env;
    }

    const nextEnv = { ...env };
    for (const line of result.stdout.split(/\r?\n/u)) {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);
        nextEnv[key] = value;
    }

    return nextEnv;
}

function withWindowsSdk(env) {
    if (!isWindows || commandExists('rc.exe', env)) {
        return env;
    }

    const programFilesX86 = process.env['ProgramFiles(x86)'];
    if (!programFilesX86) {
        return env;
    }

    const sdkBinRoot = path.join(programFilesX86, 'Windows Kits', '10', 'bin');
    if (!existsSync(sdkBinRoot)) {
        return env;
    }

    const versionDirs = readdirSync(sdkBinRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(sdkBinRoot, entry.name, 'x64'))
        .filter((candidate) => existsSync(path.join(candidate, 'rc.exe')))
        .sort()
        .reverse();

    if (versionDirs.length === 0) {
        return env;
    }

    const nextEnv = { ...env };
    prependPathEntries(nextEnv, [versionDirs[0]]);
    return nextEnv;
}

export function createToolEnvironment(baseEnv = process.env, root = repoRoot) {
    const env = { ...baseEnv };
    const depsDir = resolveDepsDir(root);
    const pathEntries = [];

    if (depsDir) {
        const cargoHome = path.join(depsDir, 'rust', 'cargo-home');
        const rustupHome = path.join(depsDir, 'rust', 'rustup-home');

        pathEntries.push(
            path.join(depsDir, 'bin'),
            path.join(depsDir, 'node'),
            path.join(depsDir, 'Tools', 'PowerShell', '7.6.0'),
            path.join(cargoHome, 'bin'),
        );

        if (existsSync(cargoHome)) {
            env.CARGO_HOME = cargoHome;
        }

        if (existsSync(rustupHome)) {
            env.RUSTUP_HOME = rustupHome;
        }
    }

    prependPathEntries(env, pathEntries);
    return withWindowsSdk(withMsvcEnvironment(env));
}
