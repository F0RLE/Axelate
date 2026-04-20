# Getting Started

This document describes the commands and prerequisites that actually matter today.

## Requirements

- Node.js 20+
- npm 10+
- Rust stable
- Windows: Visual Studio Build Tools, Windows SDK, and WebView2 Runtime

Tauri on Windows depends on machine-level native tooling. Portable Node and Rust are supported, but MSVC, SDK tools, and WebView2 still need to exist on the machine.

## Windows prerequisites

Install:

- Microsoft C++ Build Tools with the `Desktop development with C++` workload
- Windows 10/11 SDK so `rc.exe` is available
- Microsoft Edge WebView2 Runtime

## Portable toolchains

The workflow runner checks for portable tools in this order:

1. `AXELATE_DEPS_DIR`
2. `<repo>/.deps`
3. `%USERPROFILE%/Axelate-deps`

Expected layout:

```text
deps-root/
├── bin/
│   ├── cargo.cmd
│   ├── node.cmd
│   ├── npm.cmd
│   ├── npx.cmd
│   └── rustup.cmd
├── node/
└── rust/
    ├── cargo-home/
    └── rustup-home/
```

## Install

From the repository root:

```bash
git clone https://github.com/F0RLE/Axelate.git
cd Axelate
npm run setup
```

`npm run setup` is the canonical first-run command. It runs `doctor`, installs frontend dependencies into `src/node_modules`, and configures Git hooks.

## Daily development

Recommended start:

```bash
npm run dev
```

Useful commands:

```bash
npm run doctor
npm run test
npm run typecheck
npm run lint
npm run verify
```

What they do:

- `doctor` checks prerequisites without changing files.
- `dev` starts the desktop app in Tauri development mode.
- `verify` runs the full local gate.

## Build and release

```bash
npm run build
npm run tauri:build
npm run release
```

- `build` builds the frontend bundle.
- `tauri:build` builds the desktop app.
- `release` runs verification first, then produces release bundles.

## First app launch

Current happy path:

1. open Axelate
2. go to Settings
3. add an OpenRouter key
4. choose an active model/provider
5. optionally install local engines or modules

## Verification gate

Before release work, run:

```bash
npm run verify
```

That gate includes:

- prerequisite check
- Rust format, clippy, check, and tests
- frontend install
- frontend format, typecheck, lint, format check, tests, build, and size budget

If `verify` is red, the repository is not ready for release work.

## Common issues

### WebView2 missing

Install Microsoft Edge WebView2 Runtime.

### `rc.exe` missing

Install the Windows SDK through Visual Studio Build Tools.

### Wrong dependency layout

This repository should use `src/node_modules`. A second root `node_modules` tree is not part of the intended workflow.

## Related docs

- [Architecture](architecture.md)
- [Automation](AUTOMATION.md)
- [Project Tree](reference/project-tree/ProjectTree.md)
- [Coding Standards](CODING_STANDARDS.md)
- [Security Hardening](SECURITY_HARDENING.md)
- [Roadmap](ROADMAP.md)
