#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const defaultOutput = path.join(
    repoRoot,
    'docs',
    'en',
    'reference',
    'project-tree',
    'ProjectTree.generated.md',
);
const outputPath = path.resolve(repoRoot, process.argv[2] ?? defaultOutput);

function getTrackedFiles() {
    const stdout = execFileSync('git', ['ls-files'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    return stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

function createNode(name = '') {
    return {
        name,
        children: new Map(),
        isFile: false,
    };
}

function buildTree(files) {
    const root = createNode();

    files.forEach((file) => {
        const parts = file.split('/');
        let current = root;

        parts.forEach((part, index) => {
            if (!current.children.has(part)) {
                current.children.set(part, createNode(part));
            }

            current = current.children.get(part);
            current.isFile = index === parts.length - 1;
        });
    });

    return root;
}

function sortNodes(nodes) {
    return [...nodes].sort((left, right) => {
        if (left.isFile !== right.isFile) {
            return left.isFile ? 1 : -1;
        }

        return left.name.localeCompare(right.name, 'en');
    });
}

function renderTree(node, depth = 0) {
    const lines = [];
    const indent = '  '.repeat(depth);
    const children = sortNodes(node.children.values());

    children.forEach((child) => {
        const suffix = child.isFile ? '' : '/';
        lines.push(`${indent}- ${child.name}${suffix}`);

        if (!child.isFile) {
            lines.push(...renderTree(child, depth + 1));
        }
    });

    return lines;
}

function main() {
    const files = getTrackedFiles();
    const tree = buildTree(files);
    const lines = renderTree(tree);
    const markdown = [
        '# Project Tree',
        '',
        `Generated from \`git ls-files\`. Total tracked files: ${files.length}.`,
        '',
        '```text',
        ...lines,
        '```',
        '',
    ].join('\n');

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, markdown, 'utf8');

    process.stdout.write(`${path.relative(repoRoot, outputPath)}\n`);
}

main();
