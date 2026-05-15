# Axelate Getting Started

> Practical setup guide for running the project on Windows today.
> This document focuses on the real current workflow, not old repo structure.

This document describes the commands and prerequisites that actually matter today.
For day-to-day contributor work after setup, continue with [Development Workflow](DEVELOPMENT_WORKFLOW.md).

## Requirements

- Node.js 26.1.0+
- npm 11+
- Rust via `rustup` (`rust-toolchain.toml` pins the tested version)
- Windows: Visual Studio Build Tools, Windows SDK, and WebView2 Runtime

Tauri on Windows depends on machine-level native tooling.
Portable Node and Rust are supported, but MSVC, SDK tools, and WebView2 still need to exist on the machine.
The repository pins the tested Rust toolchain in `rust-toolchain.toml`; let `rustup` install that exact version.

## Windows Prerequisites

Install:

- Microsoft C++ Build Tools with the `Desktop development with C++` workload
- Windows 10/11 SDK so `rc.exe` is available
- Microsoft Edge WebView2 Runtime

After installing or updating any of these, rerun `npm run doctor`.

## Portable Toolchains

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

Run everything from the repository root:

```bash
git clone https://github.com/F0RLE/Axelate.git
cd Axelate
npm run setup
```

`npm run setup` is the canonical first-run command. It runs `doctor`, installs frontend dependencies into `src/node_modules`, and configures Git hooks.

Important:

- run project commands from the repository root
- frontend dependencies belong in `src/node_modules`
- a second root-level `node_modules` tree is not part of the intended workflow
- use `npm run setup` for normal setup; if you need a raw npm install, run it from `src`

## Daily Development

Recommended start command:

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
- `doctor` detects WebView2 from the Windows registry and resolves the MSVC environment before Rust tooling runs.
- `dev` starts the desktop app in Tauri development mode.
- `dev` reuses an existing Axelate Vite server on port `1420` when it already belongs to this repository.
- `verify` runs the full local gate.

## Build And Release

```bash
npm run build
npm run tauri:build
npm run release
```

- `build` builds the frontend bundle.
- `tauri:build` builds the desktop app.
- `release` runs verification first, then produces release bundles.

Local release builds do not publish anything to GitHub. GitHub releases are created by the tag workflow.
See [Releases](RELEASES.md) for the tag rules and checklist.

## First App Launch

Current happy path:

1. Open Axelate.
2. Go to `Settings`.
3. Add an OpenRouter key.
4. Choose an active provider and model.
5. Optionally install local engines or modules.

## Verification Gate

Before release work, run:

```bash
npm run verify
```

That gate includes:

- prerequisite check
- Rust format, clippy, check, and tests
- frontend dependency presence check
- frontend bindings check, format check, typecheck, lint, tests, and bundle build

If `verify` is red, the repository is not ready for release work.

## Common Issues

### WebView2 Missing

Install Microsoft Edge WebView2 Runtime.

### `rc.exe` Missing

Install the Windows SDK through Visual Studio Build Tools.

### Wrong Dependency Layout

This repository should use `src/node_modules`. A second root `node_modules` tree is not part of the intended workflow.
The frontend package should not depend on itself through a `file:` dependency.

### Generated Files In Git Status

`src-tauri/gen`, `src-tauri/target`, `src/dist`, `src/coverage`, and `src/.axelate` are disposable local outputs.
They are ignored on purpose and can be removed with:

```bash
npm run clear
```

## Related Docs

- [User Guide](USER_GUIDE.md)
- [Development Workflow](DEVELOPMENT_WORKFLOW.md)
- [Architecture](ARCHITECTURE.md)
- [Releases](RELEASES.md)
- [Current State](CURRENT_STATE.md)
- [Trust Model](TRUST_MODEL.md)
- [Vision](VISION.md)
- [Roadmap](ROADMAP.md)
