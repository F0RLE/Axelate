#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
    buildCommandInvocation,
    commandExists,
    createToolEnvironment,
    isWindows,
    releaseLikeTauriConfig,
    repoRoot,
    srcDir,
    tauriDir,
    windowsCmdExecutable,
} from './lib/tooling-paths.mjs';

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

function toolEnv() {
    if (cachedEnv) {
        return cachedEnv;
    }

    cachedEnv = createToolEnvironment();
    return cachedEnv;
}

function describe(command, args, cwd) {
    const renderedArgs = args.map((arg) => (/\s/u.test(arg) ? `"${arg}"` : arg)).join(' ');
    const renderedSuffix = renderedArgs.length > 0 ? ` ${renderedArgs}` : '';
    return `${cwd}> ${command}${renderedSuffix}`;
}

function run(command, args = [], options = {}) {
    const cwd = options.cwd ?? repoRoot;
    const env = options.env ?? toolEnv();
    const allowFailure = options.allowFailure ?? false;
    const invocation = buildCommandInvocation(command, args, env);

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

function checkCommand(label, command, args = ['--version'], options = {}) {
    const cwd = options.cwd ?? repoRoot;
    const env = options.env ?? toolEnv();
    const invocation = buildCommandInvocation(command, args, env);
    const result = spawnSync(invocation.command, invocation.args, {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    return {
        ok: !result.error && result.status === 0,
        label,
        required: options.required ?? true,
        details:
            result.stdout?.trim() ||
            result.stderr?.trim() ||
            result.error?.message ||
            'not available',
    };
}

function checkPath(label, targetPath, details) {
    return {
        ok: existsSync(targetPath),
        label,
        required: true,
        details,
    };
}

function checkAvailableCommand(label, command, env = toolEnv(), required = true) {
    const available = commandExists(command, env);
    return {
        ok: available,
        label,
        required,
        details: available ? `${command} available` : `${command} not available`,
    };
}

function printDoctorResult(result) {
    const status = result.ok ? 'OK' : result.required ? 'MISS' : 'WARN';
    console.log(`[doctor] ${status} ${result.label}: ${result.details}`);
}

function runDoctor() {
    const env = toolEnv();
    const results = [
        checkCommand('git', 'git'),
        checkCommand('node', 'node'),
        checkCommand('npm', 'npm'),
        checkCommand('cargo', 'cargo'),
        checkCommand('rustc', 'rustc'),
    ];

    if (isWindows) {
        results.push(
            checkPath(
                'WebView2 Runtime',
                path.join(
                    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
                    'Microsoft',
                    'EdgeWebView',
                    'Application',
                ),
                'Microsoft Edge WebView2 Runtime',
            ),
        );
        results.push(
            checkAvailableCommand(
                'MSVC compiler',
                'cl',
                env,
                false,
            ),
        );
        results.push(checkAvailableCommand('Windows SDK rc.exe', 'rc', env));
    }

    for (const result of results) {
        printDoctorResult(result);
    }

    const failed = results.filter((result) => result.required && !result.ok);
    if (failed.length > 0) {
        fail(`Doctor found ${String(failed.length)} missing prerequisite(s).`);
    }

    log('Doctor passed.');
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

    const env = toolEnv();
    const taskListInvocation = buildCommandInvocation(
        'tasklist',
        ['/FI', 'IMAGENAME eq Axelate.exe'],
        env,
    );
    const taskListResult = spawnSync(taskListInvocation.command, taskListInvocation.args, {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    const taskListOutput = `${taskListResult.stdout ?? ''}\n${taskListResult.stderr ?? ''}`;
    if (!taskListOutput.includes('Axelate.exe')) {
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
    let candidates;
    if (isWindows) {
        candidates = [
            path.join(tauriDir, 'target', 'release', 'Axelate.exe'),
            path.join(tauriDir, 'target', 'x86_64-pc-windows-msvc', 'release', 'Axelate.exe'),
        ];
    } else if (process.platform === 'darwin') {
        candidates = [path.join(tauriDir, 'target', 'release', 'bundle', 'macos', 'Axelate.app')];
    } else {
        candidates = [path.join(tauriDir, 'target', 'release', 'axelate')];
    }

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
    runDoctor();
    cleanArtifacts();
    run('cargo', ['fmt', '--all', '--check'], { cwd: tauriDir });
    run('cargo', ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'], {
        cwd: tauriDir,
    });
    run('cargo', ['check', '--all-targets', '--all-features', '--verbose'], { cwd: tauriDir });
    run('cargo', ['test', '--all-targets', '--all-features', '--verbose'], { cwd: tauriDir });
    run('npm', ['ci'], { cwd: srcDir });
    run('npm', ['run', 'format'], { cwd: srcDir });
    run('npm', ['run', 'typecheck'], { cwd: srcDir });
    run('npm', ['run', 'lint'], { cwd: srcDir });
    run('npm', ['run', 'format:check'], { cwd: srcDir });
    run('npm', ['run', 'test'], { cwd: srcDir });
    run('npm', ['run', 'build'], { cwd: srcDir });
    run('npm', ['run', 'check-size'], { cwd: srcDir });
}

function setupProject() {
    runDoctor();
    run('npm', ['ci'], { cwd: srcDir });
    runNode(path.join(srcDir, 'scripts', 'setup-git-hooks.mjs'));
    log('Setup completed. Use `npm run dev` to start development.');
}

const tasks = {
    help() {
        console.log(`Usage: node .github/scripts/workflow.mjs <task> [--dry-run] [--deep] [--open]

Tasks:
  dev            Start the desktop app in Tauri webview development mode
  dev:app        Alias for Tauri webview development mode
  dev:webview    Start the desktop app in Tauri webview development mode
  dev:inspect    Start the desktop app with DevTools and WebView remote debugging
  dev:release-like  Start the desktop app with built static assets (release-like)
  build          Build the frontend bundle
  clear          Remove build artifacts and caches
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
  doctor         Check local development prerequisites
  setup          Validate prerequisites, install frontend deps, and configure hooks
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
    clear() {
        cleanArtifacts();
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
    doctor() {
        runDoctor();
    },
    setup() {
        setupProject();
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
    fail(`Unknown task '${taskName}'. Run 'node .github/scripts/workflow.mjs help'.`);
}

task();
