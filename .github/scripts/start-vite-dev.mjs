#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
    buildCommandInvocation,
    createToolEnvironment,
    isWindows,
    srcDir,
} from './lib/tooling-paths.mjs';

const devPort = 1420;
const workspaceNodeModulesPath = normalizeForComparison(path.join(srcDir, 'node_modules'));
const viteCommandMarker = 'vite\\bin\\vite.js';
const dependencyManifestFiles = [
    path.join(srcDir, 'package.json'),
    path.join(srcDir, 'package-lock.json'),
];
const viteStateFile = path.join(srcDir, '.axelate', 'vite-dev-state.json');

function log(message) {
    console.log(`[vite-dev] ${message}`);
}

function fail(message) {
    console.error(`[vite-dev] ${message}`);
    process.exit(1);
}

function normalizeForComparison(value) {
    return value.replaceAll('/', '\\').toLowerCase();
}

function getListeningProcessesOnWindows(port, env) {
    const command = [
        '$ErrorActionPreference = "Stop"',
        `$ports = @(Get-NetTCPConnection -LocalPort ${String(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)`,
        '$processes = @()',
        'foreach ($owningProcess in $ports) {',
        '  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owningProcess" | Select-Object ProcessId, Name, ExecutablePath, CommandLine',
        '  if ($process) { $processes += $process }',
        '}',
        '$processes | ConvertTo-Json -Compress',
    ].join('; ');

    const invocation = buildCommandInvocation(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        env,
    );
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: srcDir,
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

function isWorkspaceViteProcess(processInfo) {
    const commandLine = normalizeForComparison(processInfo?.CommandLine ?? '');
    return (
        commandLine.includes(workspaceNodeModulesPath) && commandLine.includes(viteCommandMarker)
    );
}

function describeProcess(processInfo) {
    const parts = [
        processInfo?.Name ? `${processInfo.Name}` : 'unknown process',
        processInfo?.ProcessId ? `pid=${String(processInfo.ProcessId)}` : null,
        processInfo?.ExecutablePath ? `path=${processInfo.ExecutablePath}` : null,
    ].filter(Boolean);

    return parts.join(' ');
}

function computeDependencyFingerprint() {
    const hash = createHash('sha256');

    for (const filePath of dependencyManifestFiles) {
        hash.update(filePath);
        hash.update('\n');
        if (existsSync(filePath)) {
            hash.update(readFileSync(filePath));
        }
        hash.update('\n');
    }

    return hash.digest('hex');
}

function readViteState() {
    if (!existsSync(viteStateFile)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(viteStateFile, 'utf8'));
    } catch {
        return null;
    }
}

function writeViteState(state) {
    mkdirSync(path.dirname(viteStateFile), { recursive: true });
    writeFileSync(viteStateFile, JSON.stringify(state, null, 2));
}

function installFrontendDependencies(env, reason) {
    const invocation = buildCommandInvocation('npm', ['install'], env);
    log(`refresh frontend dependencies (${reason})`);
    log(`${srcDir}> ${invocation.command} ${invocation.args.join(' ')}`);

    const result = spawnSync(invocation.command, invocation.args, {
        cwd: srcDir,
        env,
        stdio: 'inherit',
        shell: false,
    });

    if (result.status !== 0) {
        fail(`npm install failed with code ${String(result.status ?? 1)}`);
    }
}

function stopWorkspaceViteProcess(processInfo, env) {
    if (!processInfo?.ProcessId) {
        return;
    }

    if (isWindows) {
        const invocation = buildCommandInvocation(
            'taskkill',
            ['/F', '/PID', String(processInfo.ProcessId), '/T'],
            env,
        );
        log(`restart Vite dev server pid=${String(processInfo.ProcessId)}`);
        const result = spawnSync(invocation.command, invocation.args, {
            cwd: srcDir,
            env,
            stdio: 'inherit',
            shell: false,
        });

        if (result.status !== 0) {
            fail(`Failed to stop existing Vite dev server pid=${String(processInfo.ProcessId)}`);
        }
        return;
    }

    try {
        process.kill(processInfo.ProcessId, 'SIGTERM');
    } catch (error) {
        fail(`Failed to stop existing Vite dev server: ${error.message}`);
    }
}

function runViteDev() {
    const env = createToolEnvironment();
    const dependencyFingerprint = computeDependencyFingerprint();
    const viteState = readViteState();
    const shouldRefreshDependencies =
        !existsSync(path.join(srcDir, 'node_modules')) ||
        viteState?.dependencyFingerprint !== dependencyFingerprint;
    const listeners = isWindows ? getListeningProcessesOnWindows(devPort, env) : [];

    if (listeners.length > 0) {
        const workspaceVite = listeners.find(isWorkspaceViteProcess);
        if (workspaceVite) {
            if (shouldRefreshDependencies) {
                stopWorkspaceViteProcess(workspaceVite, env);
                installFrontendDependencies(env, 'dependency manifest changed');
            } else {
                log(`reuse existing Vite dev server on http://localhost:${String(devPort)}`);
                return;
            }
        }

        const remainingListeners = isWindows ? getListeningProcessesOnWindows(devPort, env) : [];
        if (remainingListeners.length > 0) {
            fail(
                `Port ${String(devPort)} is already in use by ${describeProcess(remainingListeners[0])}. Stop that process or free the port.`,
            );
        }
    } else if (shouldRefreshDependencies) {
        installFrontendDependencies(env, 'dependency manifest changed');
    }

    const invocation = buildCommandInvocation('npm', ['run', 'dev'], env);
    log(`${srcDir}> ${invocation.command} ${invocation.args.join(' ')}`);

    const child = spawn(invocation.command, invocation.args, {
        cwd: srcDir,
        env,
        stdio: 'inherit',
        shell: false,
    });

    child.on('error', (error) => {
        fail(`Failed to start Vite dev server: ${error.message}`);
    });

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(signal, () => {
            if (!child.killed) {
                child.kill(signal);
            }
        });
    }

    child.on('exit', (code) => {
        process.exit(code ?? 1);
    });

    writeViteState({
        dependencyFingerprint,
        updatedAt: new Date().toISOString(),
    });
}

runViteDev();
