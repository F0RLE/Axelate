#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FORBIDDEN_ENTRIES = new Set([
    '.axelate',
    '.git',
    '.venv',
    '__pycache__',
    'build',
    'dist',
    'node_modules',
    'target',
]);

const VALID_RUNTIME_KINDS = new Set(['python', 'node', 'bun', 'binary']);
const REQUIRED_TOP_LEVEL_FIELDS = ['api_version', 'id', 'name', 'version', 'type'];

const targetArg = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? '.';
const root = path.resolve(targetArg);
const manifestPath = path.join(root, 'axelate-module.toml');
const findings = [];

function add(level, message) {
    findings.push({ level, message });
}

function readManifest() {
    if (!existsSync(root)) {
        add('error', `Integration folder does not exist: ${root}`);
        return null;
    }

    if (!statSync(root).isDirectory()) {
        add('error', `Integration path must be a directory: ${root}`);
        return null;
    }

    if (!existsSync(manifestPath)) {
        add('error', 'Missing axelate-module.toml');
        return null;
    }

    return readFileSync(manifestPath, 'utf8');
}

function parseManifest(source) {
    const values = new Map();
    let section = '';

    source.split(/\r?\n/u).forEach((rawLine) => {
        const line = rawLine.replace(/#.*/u, '').trim();
        if (line.length === 0) {
            return;
        }

        const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/u);
        if (sectionMatch) {
            section = sectionMatch[1];
            return;
        }

        const fieldMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
        if (!fieldMatch) {
            return;
        }

        const key = section.length > 0 ? `${section}.${fieldMatch[1]}` : fieldMatch[1];
        values.set(key, normalizeTomlScalar(fieldMatch[2]));
    });

    return values;
}

function normalizeTomlScalar(rawValue) {
    const trimmed = rawValue.trim();
    const quoted = trimmed.match(/^"([\s\S]*)"$/u);
    if (quoted) {
        return quoted[1].replace(/\\"/gu, '"');
    }

    const singleQuoted = trimmed.match(/^'([\s\S]*)'$/u);
    if (singleQuoted) {
        return singleQuoted[1];
    }

    return trimmed;
}

function isSafeRelativePath(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return false;
    }

    const normalized = value.replaceAll('\\', '/');
    if (path.isAbsolute(normalized)) {
        return false;
    }

    return !normalized.split('/').some((part) => part === '..' || part.length === 0);
}

function checkExistingFile(values, key) {
    const value = values.get(key);
    if (value === undefined) {
        return;
    }

    if (!isSafeRelativePath(value)) {
        add('error', `${key} must be a safe relative path`);
        return;
    }

    const resolved = path.resolve(root, value);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
        add('error', `${key} resolves outside the integration folder`);
        return;
    }

    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        add('error', `${key} points to a missing file: ${value}`);
    }
}

function checkSettingsUi(values) {
    const value = values.get('settings_ui');
    if (value === undefined) {
        add('warn', 'No settings_ui configured; users will not get a custom settings panel.');
        return;
    }

    if (!isSafeRelativePath(value)) {
        add('error', 'settings_ui must be a safe relative path');
        return;
    }

    const resolved = path.resolve(root, value);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
        add('error', 'settings_ui resolves outside the integration folder');
        return;
    }

    if (!existsSync(resolved)) {
        add('error', `settings_ui path does not exist: ${value}`);
        return;
    }

    const stats = statSync(resolved);
    if (stats.isDirectory()) {
        const indexPath = path.join(resolved, 'index.html');
        if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
            add('error', `settings_ui directory must contain index.html: ${value}`);
        }
        return;
    }

    if (!stats.isFile() || path.basename(resolved).toLowerCase() !== 'index.html') {
        add('warn', 'settings_ui should usually point to an index.html file or directory.');
    }
}

function checkFilesystemTree(directory = root) {
    readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
        const entryPath = path.join(directory, entry.name);
        const relativePath = path.relative(root, entryPath);
        if (FORBIDDEN_ENTRIES.has(entry.name)) {
            add('error', `Do not ship generated/runtime directory: ${relativePath}`);
            return;
        }

        if (entry.isSymbolicLink()) {
            add('error', `Symlinks are not supported in integration imports: ${relativePath}`);
            return;
        }

        if (entry.isDirectory()) {
            checkFilesystemTree(entryPath);
        }
    });
}

function checkManifest(values) {
    REQUIRED_TOP_LEVEL_FIELDS.forEach((field) => {
        if (!values.has(field)) {
            add('error', `Missing required manifest field: ${field}`);
        }
    });

    const id = values.get('id');
    if (typeof id === 'string' && !/^[A-Za-z0-9_-]+$/u.test(id)) {
        add('error', 'id may contain only letters, numbers, "-" and "_"');
    }

    const runtimeKind = values.get('runtime.kind');
    if (!runtimeKind) {
        add('error', 'Missing [runtime].kind');
    } else if (!VALID_RUNTIME_KINDS.has(runtimeKind)) {
        add('error', `runtime.kind must be one of: ${Array.from(VALID_RUNTIME_KINDS).join(', ')}`);
    }

    if (!values.has('runtime.entry')) {
        add('error', 'Missing [runtime].entry');
    } else {
        checkExistingFile(values, 'runtime.entry');
    }

    checkExistingFile(values, 'runtime.dependencies');
    checkSettingsUi(values);

    if (runtimeKind === 'binary' && !values.has('lifecycle.start.program')) {
        add('error', 'binary integrations must define [lifecycle.start].program');
    }
}

const source = readManifest();
if (source !== null) {
    const values = parseManifest(source);
    checkManifest(values);
    checkFilesystemTree();
}

const errors = findings.filter((finding) => finding.level === 'error');
const warnings = findings.filter((finding) => finding.level === 'warn');

if (findings.length === 0) {
    console.log(`[integration:doctor] ok ${root}`);
} else {
    findings.forEach((finding) => {
        console.log(`[integration:doctor] ${finding.level}: ${finding.message}`);
    });
}

console.log(`[integration:doctor] ${errors.length} error(s), ${warnings.length} warning(s)`);

process.exit(errors.length > 0 ? 1 : 0);
