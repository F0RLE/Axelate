#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
    buildCommandInvocation,
    createToolEnvironment,
    repoRoot,
    srcDir,
    tauriDir,
} from './lib/tooling-paths.mjs';

const hookName = process.argv[2];
const hookArgs = process.argv.slice(3);
const env = createToolEnvironment();

function fail(message) {
    console.error(`[hook] ${message}`);
    process.exit(1);
}

function run(command, args = [], cwd = repoRoot) {
    const invocation = buildCommandInvocation(command, args, env);
    const result = spawnSync(invocation.command, invocation.args, {
        cwd,
        env,
        stdio: 'inherit',
        shell: false,
    });
    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}

function runPreCommit() {
    run('npm', ['run', 'lint'], srcDir);
    run('npm', ['run', 'format:check'], srcDir);
    run('npm', ['run', 'test'], srcDir);
    run('cargo', ['fmt', '--manifest-path', path.join(tauriDir, 'Cargo.toml'), '--', '--check']);
    run('cargo', ['clippy', '--manifest-path', path.join(tauriDir, 'Cargo.toml'), '--', '-D', 'warnings']);
}

function runCommitMsg() {
    const commitMessageFile = hookArgs[0];
    if (!commitMessageFile) {
        fail('commit-msg hook requires a path to the commit message file');
    }

    run('npm', [
        'exec',
        '--',
        'commitlint',
        '--config',
        path.join(repoRoot, '.github', 'commitlint.config.js'),
        '--edit',
        commitMessageFile,
    ], srcDir);
}

const hooks = {
    'pre-commit': runPreCommit,
    'commit-msg': runCommitMsg,
};

const hook = hooks[hookName];
if (!hook) {
    fail(`unknown hook '${hookName}'`);
}

hook();
