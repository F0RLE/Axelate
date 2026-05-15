#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const webView2RuntimeClientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
const cargoLlvmCovVersion = '0.8.5';
const sleepSignal = new Int32Array(new SharedArrayBuffer(4));

function cleanupTargets() {
    const targets = [
        path.join(srcDir, 'dist'),
        path.join(srcDir, 'coverage'),
        path.join(srcDir, 'node_modules', '.cache'),
        path.join(srcDir, 'node_modules', '.vite'),
        path.join(srcDir, '.axelate'),
        path.join(srcDir, '.vite'),
        path.join(srcDir, 'playwright-report'),
        path.join(srcDir, 'test-results'),
        path.join(tauriDir, 'target'),
        path.join(tauriDir, 'gen'),
        path.join(tauriDir, 'check_output.txt'),
        path.join(tauriDir, 'test_appdata_roaming'),
        path.join(repoRoot, 'build'),
    ];

    if (deepClean) {
        targets.push(path.join(srcDir, 'node_modules'));
    }

    return targets;
}

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

function sleep(milliseconds) {
    Atomics.wait(sleepSignal, 0, 0, milliseconds);
}

function isRetryableRemoveError(error) {
    if (!isWindows || !error || typeof error !== 'object') {
        return false;
    }

    return ['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code);
}

function removePath(targetPath) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            rmSync(targetPath, { recursive: true, force: true });
            return;
        } catch (error) {
            if (!isRetryableRemoveError(error) || attempt === 5) {
                throw error;
            }

            const delayMs = attempt * 250;
            log(
                `retry remove ${path.relative(repoRoot, targetPath) || '.'} in ${String(delayMs)}ms`,
            );
            sleep(delayMs);
        }
    }
}

function ensureInsideRepo(targetPath) {
    const relative = path.relative(repoRoot, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(`Refusing to remove path outside repo: ${targetPath}`);
    }
}

function assertCondition(condition, message) {
    if (!condition) {
        fail(message);
    }

    log(`ok: ${message}`);
}

function run(command, args = [], options = {}) {
    const cwd = options.cwd ?? repoRoot;
    const env = options.env ?? toolEnv();
    const allowFailure = options.allowFailure ?? false;
    const logCommand = options.logCommand ?? true;
    const invocation = buildCommandInvocation(command, args, env);

    if (logCommand) {
        log(describe(invocation.command, invocation.args, cwd));
    }
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

function withDirectPassthroughArgs(baseArgs) {
    if (passthroughArgs.length === 0) {
        return baseArgs;
    }

    return [...baseArgs, ...passthroughArgs];
}

function withEnvOverrides(overrides = {}) {
    return {
        ...toolEnv(),
        ...overrides,
    };
}

function ensureCargoLlvmCov() {
    if (commandExists('cargo-llvm-cov', toolEnv())) {
        const invocation = buildCommandInvocation('cargo', ['llvm-cov', '--version'], toolEnv());
        const result = spawnSync(invocation.command, invocation.args, {
            cwd: tauriDir,
            env: toolEnv(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
        const versionOutput = result.stdout?.trim() || result.stderr?.trim() || '';
        const installedVersion = versionOutput.match(/\d+\.\d+\.\d+/u)?.[0];
        if (!result.error && result.status === 0 && installedVersion === cargoLlvmCovVersion) {
            ensureLlvmTools();
            return;
        }

        log(
            `cargo-llvm-cov version mismatch (installed: ${installedVersion ?? 'unknown'}, expected: ${cargoLlvmCovVersion}); reinstalling`,
        );
    }

    log(`installing cargo-llvm-cov version ${cargoLlvmCovVersion} with cargo install --locked`);
    run('cargo', [
        'install',
        'cargo-llvm-cov',
        '--locked',
        '--version',
        cargoLlvmCovVersion,
        '--force',
    ]);
    ensureLlvmTools();
}

function ensureLlvmTools() {
    if (!commandExists('rustup', toolEnv())) {
        return;
    }

    run('rustup', ['component', 'add', 'llvm-tools']);
}

function runRustCoverage(args = []) {
    ensureCargoLlvmCov();
    run('cargo', ['llvm-cov', ...args], { cwd: tauriDir });
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

function checkAvailableCommand(label, command, env = toolEnv(), required = true) {
    const available = commandExists(command, env);
    return {
        ok: available,
        label,
        required,
        details: available ? `${command} available` : `${command} not available`,
    };
}

function queryWindowsRegistryValue(key, valueName, env = toolEnv()) {
    const invocation = buildCommandInvocation('reg.exe', ['query', key, '/v', valueName], env);
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    if (result.error || result.status !== 0 || !result.stdout) {
        return null;
    }

    const pattern = new RegExp(`\\s${valueName}\\s+REG_\\w+\\s+(.+)$`, 'u');
    for (const line of result.stdout.split(/\r?\n/u)) {
        const match = line.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    return null;
}

function checkWindowsWebView2Runtime(env = toolEnv()) {
    const registryKeys = [
        `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${webView2RuntimeClientId}`,
        `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${webView2RuntimeClientId}`,
        `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${webView2RuntimeClientId}`,
    ];

    const versions = registryKeys
        .map((key) => ({ key, version: queryWindowsRegistryValue(key, 'pv', env) }))
        .filter(({ version }) => version && version !== '0.0.0.0');

    if (versions.length === 0) {
        return {
            ok: false,
            label: 'WebView2 Runtime',
            required: true,
            details: 'runtime not found in HKLM/HKCU EdgeUpdate registry keys',
        };
    }

    return {
        ok: true,
        label: 'WebView2 Runtime',
        required: true,
        details: `version ${versions[0].version}`,
    };
}

function normalizeWindowsPath(targetPath) {
    return path.win32.normalize(targetPath).toLowerCase();
}

function workspaceAxelateExecutablePaths() {
    const targetVariants = [
        ['debug'],
        ['release'],
        ['x86_64-pc-windows-msvc', 'debug'],
        ['x86_64-pc-windows-msvc', 'release'],
        ['x86_64-pc-windows-gnu', 'debug'],
        ['x86_64-pc-windows-gnu', 'release'],
    ];

    return targetVariants.map((segments) =>
        path.join(tauriDir, 'target', ...segments, 'Axelate.exe'),
    );
}

function getWindowsProcesses(env = toolEnv()) {
    const command = [
        '$ErrorActionPreference = "Stop"',
        '$processes = @(Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ParentProcessId, ExecutablePath, CommandLine)',
        '$processes | ConvertTo-Json -Compress',
    ].join('; ');
    const invocation = buildCommandInvocation(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        env,
    );
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    if (result.error || result.status !== 0 || !result.stdout.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(result.stdout);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

function getRunningWindowsProcesses(imageName, env = toolEnv()) {
    const command = [
        '$ErrorActionPreference = "Stop"',
        `$processes = @(Get-CimInstance Win32_Process -Filter "Name = '${imageName}'" | Select-Object ProcessId, ExecutablePath)`,
        '$processes | ConvertTo-Json -Compress',
    ].join('; ');
    const invocation = buildCommandInvocation(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        env,
    );
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    if (result.error || result.status !== 0 || !result.stdout.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(result.stdout);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

function isProtectedWorkflowProcess(processInfo) {
    const processId = Number(processInfo?.ProcessId ?? 0);
    return processId === process.pid || processId === process.ppid;
}

function commandLineContainsPath(commandLine, targetPath) {
    return normalizeWindowsPath(commandLine).includes(normalizeWindowsPath(targetPath));
}

function isWorkspaceDevSupervisor(processInfo) {
    if (!processInfo?.CommandLine || isProtectedWorkflowProcess(processInfo)) {
        return false;
    }

    const processName = String(processInfo.Name ?? '').toLowerCase();
    const commandLine = normalizeWindowsPath(processInfo.CommandLine);
    const isWorkspaceProcess =
        commandLineContainsPath(processInfo.CommandLine, repoRoot) ||
        commandLineContainsPath(processInfo.CommandLine, srcDir) ||
        commandLineContainsPath(processInfo.CommandLine, tauriDir);

    if (!isWorkspaceProcess) {
        return false;
    }

    const isTauriDevCommand =
        commandLine.includes('tauri') &&
        commandLine.includes('dev') &&
        !commandLine.includes('workflow.mjs');
    const isCargoDevRunner =
        processName === 'cargo.exe' &&
        commandLine.includes('run') &&
        commandLine.includes('no-default-features');

    return (
        ((processName === 'node.exe' || processName === 'cmd.exe') && isTauriDevCommand) ||
        isCargoDevRunner
    );
}

function stopWindowsProcessTree(processInfo, label) {
    if (!processInfo?.ProcessId) {
        return;
    }

    log(`stop ${label} pid=${String(processInfo.ProcessId)}`);
    run('taskkill', ['/F', '/PID', String(processInfo.ProcessId), '/T'], {
        allowFailure: true,
    });
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
        results.push(checkWindowsWebView2Runtime(env));
        results.push(checkAvailableCommand('MSVC compiler', 'cl', env));
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
    const requiredFrontendBins = ['eslint', 'prettier', 'vite', 'vitest'].map((name) =>
        path.join(srcDir, 'node_modules', '.bin', isWindows ? `${name}.cmd` : name),
    );
    const hasNodeModulesDir = existsSync(nodeModulesDir);
    const hasFrontendBins = requiredFrontendBins.every((binPath) => existsSync(binPath));

    if (!hasNodeModulesDir) {
        log('frontend dependencies missing; running npm ci');
        run('npm', ['ci'], { cwd: srcDir });
        return;
    }

    if (!hasFrontendBins) {
        log('frontend dependencies incomplete; running npm install');
        run('npm', ['install'], { cwd: srcDir });
    }
}

function syncFrontendBindings() {
    run(
        'cargo',
        ['run', '--quiet', '--manifest-path', '../src-tauri/Cargo.toml', '--bin', 'exporter'],
        {
            cwd: srcDir,
            logCommand: false,
        },
    );
}

function removeTomlInlineComment(line) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\' && inDoubleQuote) {
            escaped = true;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }

        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (char === '#' && !inSingleQuote && !inDoubleQuote) {
            return line.slice(0, index);
        }
    }

    return line;
}

function readCargoReleaseProfile() {
    const cargoTomlPath = path.join(tauriDir, 'Cargo.toml');
    const cargoToml = readFileSync(cargoTomlPath, 'utf8');
    const profile = new Map();
    let inReleaseProfile = false;

    for (const rawLine of cargoToml.split(/\r?\n/u)) {
        const trimmedLine = rawLine.trim();
        const sectionMatch = trimmedLine.match(/^\[(.+)\]$/u);
        if (sectionMatch) {
            inReleaseProfile = sectionMatch[1] === 'profile.release';
            continue;
        }

        if (!inReleaseProfile || trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
            continue;
        }

        const settingLine = removeTomlInlineComment(rawLine).trim();
        const settingMatch = settingLine.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u);
        if (settingMatch) {
            profile.set(settingMatch[1], settingMatch[2].trim());
        }
    }

    return profile;
}

function verifyReleaseHardening() {
    const tauriConfigPath = path.join(tauriDir, 'tauri.conf.json');
    const releaseProfile = readCargoReleaseProfile();
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
    const targets = Array.isArray(tauriConfig.bundle?.targets) ? tauriConfig.bundle.targets : [];

    assertCondition(releaseProfile.get('lto') === 'true', 'Cargo release profile enables LTO');
    assertCondition(
        releaseProfile.get('panic') === '"abort"',
        'Cargo release profile aborts on panic',
    );
    assertCondition(releaseProfile.get('strip') === 'true', 'Cargo release profile strips symbols');
    assertCondition(
        releaseProfile.get('overflow-checks') === 'true',
        'Cargo release profile keeps overflow checks',
    );
    assertCondition(tauriConfig.bundle?.active === true, 'Tauri bundling is enabled');
    assertCondition(
        targets.includes('msi') && targets.includes('nsis'),
        'Windows release targets include MSI and NSIS',
    );
    assertCondition(
        typeof tauriConfig.app?.security?.csp === 'string' &&
            tauriConfig.app.security.csp.trim().length > 0,
        'Application CSP is configured',
    );
    assertCondition(
        typeof tauriConfig.bundle?.windows?.webviewInstallMode?.type === 'string' &&
            tauriConfig.bundle.windows.webviewInstallMode.type.trim().length > 0,
        'WebView2 install mode is configured',
    );
    assertCondition(
        typeof tauriConfig.bundle?.windows?.nsis?.minimumWebview2Version === 'string' &&
            tauriConfig.bundle.windows.nsis.minimumWebview2Version.trim().length > 0,
        'NSIS minimum WebView2 version is configured',
    );
}

function listFilesRecursive(rootDir) {
    const files = [];
    const entries = readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(entryPath));
            continue;
        }

        if (entry.isFile()) {
            files.push(entryPath);
        }
    }

    return files;
}

function writeReleaseChecksums() {
    const bundleDir = path.join(tauriDir, 'target', 'release', 'bundle');
    if (!existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
        fail(`Release bundle directory not found: ${bundleDir}`);
    }

    const checksumFileName = 'SHA256SUMS.txt';
    const checksumPath = path.join(bundleDir, checksumFileName);
    const bundleFiles = listFilesRecursive(bundleDir)
        .filter((filePath) => path.basename(filePath) !== checksumFileName)
        .sort((left, right) => left.localeCompare(right));

    if (bundleFiles.length === 0) {
        fail('No release artifacts found for checksum generation.');
    }

    const lines = bundleFiles.map((filePath) => {
        const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
        const relativePath = path.relative(bundleDir, filePath).replace(/\\/gu, '/');

        return `${hash} *${relativePath}`;
    });

    writeFileSync(checksumPath, `${lines.join('\n')}\n`, 'ascii');
    log(`Checksums saved: ${checksumPath}`);
}

function stopRunningApp() {
    if (!isWindows) {
        return;
    }

    const env = toolEnv();
    const devSupervisors = getWindowsProcesses(env).filter(isWorkspaceDevSupervisor);
    for (const processInfo of devSupervisors) {
        stopWindowsProcessTree(processInfo, String(processInfo.Name ?? 'dev process'));
    }

    const workspaceExecutables = new Set(
        workspaceAxelateExecutablePaths().map((candidate) => normalizeWindowsPath(candidate)),
    );
    const runningProcesses = getRunningWindowsProcesses('Axelate.exe', env).filter(
        (processInfo) => {
            if (!processInfo?.ExecutablePath) {
                return false;
            }

            return workspaceExecutables.has(normalizeWindowsPath(processInfo.ExecutablePath));
        },
    );

    for (const processInfo of runningProcesses) {
        stopWindowsProcessTree(processInfo, 'Axelate.exe');
    }
}

function cleanArtifacts() {
    stopRunningApp();

    for (const target of cleanupTargets()) {
        ensureInsideRepo(target);
        if (!existsSync(target)) {
            continue;
        }

        log(`remove ${path.relative(repoRoot, target) || '.'}`);
        if (!dryRun) {
            removePath(target);
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
    ensureFrontendDependencies();
    run('npm', ['run', 'format:check'], { cwd: srcDir });
    run('npm', ['run', 'typecheck'], { cwd: srcDir });
    lintProject();
    run('npm', ['run', 'test'], { cwd: srcDir });
    run('npm', ['run', 'build:bundle'], { cwd: srcDir });
}

function lintProject() {
    run('npm', ['--prefix', 'src', 'run', 'lint']);
    run('npm', [
        '--prefix',
        'src',
        'exec',
        '--',
        'eslint',
        '--config',
        'src/eslint.config.js',
        '.github/scripts',
        '.github/commitlint.config.js',
        '--no-ignore',
    ]);
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
  clear          Remove generated artifacts and caches (use --deep for src/node_modules)
  preview        Preview the frontend bundle
  tauri:dev      Alias for desktop app development mode
  tauri:build    Build the desktop app
  release        Run verify and build a release app bundle
  release:checksums  Generate SHA256 checksums for release bundles
  release:verify-hardening  Validate release hardening settings
  run            Launch the built app artifact
  lint           Run frontend and repository tooling lint checks
  format         Format frontend files
  format:check   Check frontend formatting
  test           Run frontend tests
  test:coverage  Run frontend tests with coverage
  test:coverage:all  Run frontend and Rust coverage
  rust:test:coverage  Run Rust tests with coverage summary
  rust:test:coverage:lcov  Generate Rust LCOV report at src-tauri/lcov.info
    Note: Rust coverage passthrough args go directly to cargo-llvm-cov; bare "--" is stripped, so cargo test filters cannot be forwarded here.
  test:watch     Run frontend tests in watch mode
  typecheck      Run frontend type checks
  verify         Run the full local verification pipeline
  doctor         Check local development prerequisites
  setup          Validate prerequisites, install frontend deps, and configure hooks
  install-deps   Install frontend dependencies
  integration:doctor  Validate an Axelate integration folder
  integration:new     Scaffold a minimal Python, Node, or Bun integration folder
  update         Update npm and cargo dependencies, then verify
  prepare        Configure Git hooks
  check-size     Print a frontend bundle size report
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
    'release:checksums'() {
        writeReleaseChecksums();
    },
    'release:verify-hardening'() {
        verifyReleaseHardening();
    },
    run() {
        runReleaseBinary();
    },
    lint() {
        lintProject();
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
    'test:coverage:all'() {
        tasks['test:coverage']();
        tasks['rust:test:coverage']();
    },
    'rust:test:coverage'() {
        runRustCoverage(withDirectPassthroughArgs(['--workspace', '--all-features']));
    },
    'rust:test:coverage:lcov'() {
        runRustCoverage(
            withDirectPassthroughArgs([
                '--workspace',
                '--all-features',
                '--lcov',
                '--output-path',
                'lcov.info',
            ]),
        );
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
    'integration:doctor'() {
        ensureFrontendDependencies();
        run(
            'node',
            withPassthroughArgs([
                path.join(repoRoot, '.github', 'scripts', 'integration', 'doctor.mjs'),
            ]),
        );
    },
    'integration:new'() {
        ensureFrontendDependencies();
        run(
            'node',
            withPassthroughArgs([
                path.join(repoRoot, '.github', 'scripts', 'integration', 'scaffold.mjs'),
            ]),
        );
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
