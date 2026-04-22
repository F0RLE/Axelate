#!/usr/bin/env node

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const dryRun = process.argv.includes('--dry-run');
const deep = process.argv.includes('--deep');

const generatedTargets = [
    'build',
    'coverage',
    'src/dist',
    'src/.vite',
    'src/node_modules/.cache',
    'src/node_modules/.vite',
    'src/playwright-report',
    'src/test-results',
    'src-tauri/target',
    'src-tauri/gen',
    'src-tauri/check_output.txt',
    'src-tauri/test_appdata_roaming',
];

if (deep) {
    generatedTargets.push('src/node_modules');
}

function toAbsoluteTarget(relativeTarget) {
    return path.resolve(repoRoot, relativeTarget);
}

function ensureInsideRepo(targetPath) {
    const relative = path.relative(repoRoot, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Refusing to remove path outside repo: ${targetPath}`);
    }
}

function removeTarget(relativeTarget) {
    const absoluteTarget = toAbsoluteTarget(relativeTarget);
    ensureInsideRepo(absoluteTarget);

    if (!existsSync(absoluteTarget)) {
        return;
    }

    console.log(`[cleanup] remove ${relativeTarget}`);
    if (!dryRun) {
        rmSync(absoluteTarget, { recursive: true, force: true });
    }
}

for (const target of generatedTargets) {
    removeTarget(target);
}

console.log(
    `[cleanup] done${dryRun ? ' (dry-run)' : ''}${deep ? ' (deep)' : ''}`,
);
