#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const srcDir = path.join(repoRoot, 'src');
const tauriDir = path.join(repoRoot, 'src-tauri');
const releaseLikeTauriConfig = path.join(tauriDir, 'tauri.release-like.conf.json');
const isWindows = process.platform === 'win32';

const rawArgs = process.argv.slice(2);
const taskIndex = rawArgs.findIndex((arg) => !arg.startsWith('--'));
const taskName = taskIndex >= 0 ? rawArgs[taskIndex] : 'help';
const dryRun = rawArgs.includes('--dry-run');
const deepClean = rawArgs.includes('--deep');
const openArtifacts = rawArgs.includes('--open');
const passthroughArgs = rawArgs.filter((arg, index) => {
    if (index === taskIndex) {
        return false;
    }

    return arg !== '--dry-run' && arg !== '--deep' && arg !== '--open' && arg !== '--';
});

let cachedEnv;

function log(message) {
    console.log(`[workflow] ${message}`);
}

function fail(message) {
    console.error(`[workflow] ${message}`);
    process.exit(1);
}

function currentPathKey(env) {
    return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

function prependPathEntries(env, entries) {
    const pathKey = currentPathKey(env);
    const existing = String(env[pathKey] ?? '')
        .split(path.delimiter)
        .filter(Boolean);
    const normalized = new Set(
        existing.map((entry) => (isWindows ? entry.toLowerCase() : entry)),
    );

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

function resolveDepsDir() {
    const candidates = [
        process.env.AXELATE_DEPS_DIR,
        path.join(repoRoot, '.deps'),
        path.join(os.homedir(), 'Axelate-deps'),
    ].filter(Boolean);

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function commandExists(command, env) {
    const lookup = isWindows ? 'where.exe' : 'which';
    const result = spawnSync(lookup, [command], {
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
    });

    return result.status === 0;
}

function resolveExecutable(command, env) {
    if (!isWindows || path.isAbsolute(command) || command.includes(path.sep)) {
        return command;
    }

    const result = spawnSync('where.exe', [command], {
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

    return `"${value.replace(/"/gu, '""')}"`;
}

function buildInvocation(command, args, env) {
    const executable = resolveExecutable(command, env);
    const extension = path.extname(executable).toLowerCase();

    if (isWindows && (extension === '.cmd' || extension === '.bat')) {
        const commandLine = [executable, ...args].map(quoteForCmd).join(' ');
        return {
            command: 'cmd.exe',
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
            : path.join(
                  programFilesX86,
                  'Microsoft Visual Studio',
                  'Installer',
                  'vswhere.exe',
              );

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

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function withMsvcEnvironment(env) {
    if (!isWindows || commandExists('cl.exe', env)) {
        return env;
    }

    const vsDevCmd = findVsDevCmd();
    if (!vsDevCmd) {
        return env;
    }

    const result = spawnSync(
        'cmd.exe',
        ['/d', '/s', '/c', `""${vsDevCmd}" -arch=x64 -host_arch=x64 >nul && set"`],
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

function toolEnv() {
    if (cachedEnv) {
        return cachedEnv;
    }

    const env = { ...process.env };
    const depsDir = resolveDepsDir();
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

    cachedEnv = withWindowsSdk(withMsvcEnvironment(env));
    return cachedEnv;
}

function describe(command, args, cwd) {
    const renderedArgs = args.map((arg) => (/\s/u.test(arg) ? `"${arg}"` : arg)).join(' ');
    return `${cwd}> ${command}${renderedArgs ? ` ${renderedArgs}` : ''}`;
}

function run(command, args = [], options = {}) {
    const cwd = options.cwd ?? repoRoot;
    const env = options.env ?? toolEnv();
    const allowFailure = options.allowFailure ?? false;
    const invocation = buildInvocation(command, args, env);

    log(describe(invocation.command, invocation.args, cwd));
    if (dryRun) {
        return;
    }

    const result = spawnSync(invocation.command, invocation.args, {
        cwd,
        env,
        stdio: 'inherit',
        shell: false,
    });

    if (result.error) {
        fail(`Failed to start '${command}': ${result.error.message}`);
    }

    if ((result.status ?? 1) !== 0 && !allowFailure) {
        fail(`Command '${command}' exited with code ${result.status ?? 1}`);
    }
}

function runNode(scriptPath, args = [], options = {}) {
    run(process.execPath, [scriptPath, ...args], options);
}

function withPassthroughArgs(baseArgs) {
    if (passthroughArgs.length === 0) {
        return baseArgs;
    }

    return [...baseArgs, '--', ...passthroughArgs];
}

function withEnvOverrides(overrides = {}) {
    return {
        ...toolEnv(),
        ...overrides,
    };
}

function runTauriDev(args = [], envOverrides = {}) {
    ensureFrontendDependencies();
    syncFrontendBindings();
    stopRunningApp();
    run('npm', withPassthroughArgs(['--prefix', 'src', 'exec', 'tauri', 'dev', ...args]), {
        env: withEnvOverrides(envOverrides),
    });
}

function ensureFrontendDependencies() {
    const nodeModulesDir = path.join(srcDir, 'node_modules');
    if (!existsSync(nodeModulesDir)) {
        run('npm', ['ci'], { cwd: srcDir });
    }
}

function syncFrontendBindings() {
    run('cargo', ['run', '--manifest-path', '../src-tauri/Cargo.toml', '--bin', 'exporter'], {
        cwd: srcDir,
    });
}

function stopRunningApp() {
    if (!isWindows) {
        return;
    }

    run('taskkill', ['/F', '/IM', 'Axelate.exe', '/T'], {
        allowFailure: true,
    });
}

function cleanArtifacts() {
    const targets = [
        path.join(srcDir, 'dist'),
        path.join(srcDir, 'node_modules', '.cache'),
        path.join(srcDir, 'node_modules', '.vite'),
        path.join(srcDir, '.vite'),
        path.join(tauriDir, 'target'),
        path.join(tauriDir, 'gen'),
        path.join(tauriDir, 'check_output.txt'),
        path.join(repoRoot, 'build'),
    ];

    if (deepClean) {
        targets.push(path.join(srcDir, 'node_modules'));
    }

    for (const target of targets) {
        if (!existsSync(target)) {
            continue;
        }

        log(`remove ${path.relative(repoRoot, target) || '.'}`);
        if (!dryRun) {
            rmSync(target, { recursive: true, force: true });
        }
    }
}

function openPath(targetPath) {
    if (dryRun) {
        return;
    }

    if (isWindows) {
        run('cmd.exe', ['/c', 'start', '', targetPath], { allowFailure: true });
        return;
    }

    if (process.platform === 'darwin') {
        run('open', [targetPath], { allowFailure: true });
        return;
    }

    run('xdg-open', [targetPath], { allowFailure: true });
}

function runReleaseBinary() {
    const candidates = isWindows
        ? [
              path.join(tauriDir, 'target', 'release', 'Axelate.exe'),
              path.join(tauriDir, 'target', 'x86_64-pc-windows-msvc', 'release', 'Axelate.exe'),
          ]
        : process.platform === 'darwin'
          ? [path.join(tauriDir, 'target', 'release', 'bundle', 'macos', 'Axelate.app')]
          : [path.join(tauriDir, 'target', 'release', 'axelate')];

    const artifact = candidates.find((candidate) => existsSync(candidate));
    if (!artifact) {
        fail('Release artifact not found. Run build/release first.');
    }

    if (isWindows) {
        run(artifact, []);
        return;
    }

    openPath(artifact);
}

function verifyProject() {
    run('cargo', ['fmt', '--check'], { cwd: tauriDir });
    run('cargo', ['clippy', '--', '-D', 'warnings'], { cwd: tauriDir });
    run('cargo', ['check', '--bins', '--verbose'], { cwd: tauriDir });
    run('cargo', ['test', '--lib', '--verbose'], { cwd: tauriDir });
    run('npm', ['ci'], { cwd: srcDir });
    run('npm', ['run', 'typecheck'], { cwd: srcDir });
    run('npm', ['run', 'lint'], { cwd: srcDir });
    run('npm', ['run', 'format:check'], { cwd: srcDir });
    run('npm', ['run', 'test'], { cwd: srcDir });
    run('npm', ['run', 'build'], { cwd: srcDir });
    run('npm', ['run', 'check-size'], { cwd: srcDir });
}

const tasks = {
    help() {
        console.log(`Usage: node scripts/workflow.mjs <task> [--dry-run] [--deep] [--open]

Tasks:
  dev            Start the desktop app in Tauri webview development mode
  dev:app        Alias for Tauri webview development mode
  dev:webview    Start the desktop app in Tauri webview development mode
  dev:inspect    Start the desktop app with DevTools and WebView remote debugging
  dev:release-like  Start the desktop app with built static assets (release-like)
  build          Build the frontend bundle
  preview        Preview the frontend bundle
  tauri:dev      Alias for desktop app development mode
  tauri:build    Build the desktop app
  release        Run verify and build a release app bundle
  run            Launch the built app artifact
  lint           Run frontend lint checks
  format         Format frontend files
  format:check   Check frontend formatting
  test           Run frontend tests
  test:coverage  Run frontend tests with coverage
  test:watch     Run frontend tests in watch mode
  typecheck      Run frontend type checks
  verify         Run the full local verification pipeline
  install-deps   Install frontend dependencies
  update         Update npm and cargo dependencies, then verify
  prepare        Configure Git hooks
  clean          Remove build artifacts (use --deep for node_modules)
  check-size     Validate built frontend size
`);
    },
    dev() {
        tasks['dev:webview']();
    },
    'dev:app'() {
        tasks['dev:webview']();
    },
    'dev:webview'() {
        runTauriDev();
    },
    'dev:inspect'() {
        log('WebView inspection enabled. CDP endpoint: http://127.0.0.1:9223');
        runTauriDev([], {
            AXELATE_OPEN_DEVTOOLS: '1',
            AXELATE_WEBVIEW_DEBUG_PORT: '9223',
        });
    },
    'dev:release-like'() {
        ensureFrontendDependencies();
        syncFrontendBindings();
        run('npm', ['--prefix', 'src', 'run', 'build']);
        stopRunningApp();
        run(
            'npm',
            withPassthroughArgs([
                '--prefix',
                'src',
                'exec',
                'tauri',
                'dev',
                '--no-watch',
                '--config',
                releaseLikeTauriConfig,
            ]),
        );
    },
    build() {
        run('npm', ['--prefix', 'src', 'run', 'build']);
    },
    preview() {
        run('npm', withPassthroughArgs(['--prefix', 'src', 'run', 'preview']));
    },
    'tauri:dev'() {
        tasks['dev:webview']();
    },
    'tauri:build'() {
        ensureFrontendDependencies();
        syncFrontendBindings();
        run('npm', ['--prefix', 'src', 'exec', 'tauri', 'build']);
    },
    release() {
        verifyProject();
        stopRunningApp();
        run('npm', ['--prefix', 'src', 'exec', 'tauri', 'build', '--release']);
        if (openArtifacts) {
            openPath(path.join(tauriDir, 'target', 'release', 'bundle'));
        }
    },
    run() {
        runReleaseBinary();
    },
    lint() {
        run('npm', ['--prefix', 'src', 'run', 'lint']);
    },
    format() {
        run('npm', ['--prefix', 'src', 'run', 'format']);
    },
    'format:check'() {
        run('npm', ['--prefix', 'src', 'run', 'format:check']);
    },
    test() {
        run('npm', ['--prefix', 'src', 'run', 'test']);
    },
    'test:coverage'() {
        run('npm', ['--prefix', 'src', 'run', 'test:coverage']);
    },
    'test:watch'() {
        run('npm', ['--prefix', 'src', 'run', 'test:watch']);
    },
    typecheck() {
        run('npm', ['--prefix', 'src', 'run', 'typecheck']);
    },
    verify() {
        verifyProject();
    },
    'verify-all'() {
        verifyProject();
    },
    'install-deps'() {
        run('npm', ['ci'], { cwd: srcDir });
    },
    update() {
        run('npm', ['update'], { cwd: srcDir });
        run('cargo', ['update'], { cwd: tauriDir });
        verifyProject();
    },
    prepare() {
        runNode(path.join(srcDir, 'scripts', 'setup-git-hooks.mjs'));
    },
    clean() {
        cleanArtifacts();
    },
    'check-size'() {
        run('npm', ['--prefix', 'src', 'run', 'check-size']);
    },
};

const task = tasks[taskName];
if (!task) {
    fail(`Unknown task '${taskName}'. Run 'node scripts/workflow.mjs help'.`);
}

task();
