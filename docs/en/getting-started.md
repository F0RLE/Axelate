# Getting Started

This document describes the current repository layout and the commands that actually work today.

## Requirements

- Node.js 20+
- npm 10+
- Rust stable
- Windows: Visual Studio Build Tools and Windows SDK

Tauri on Windows also needs WebView2 at runtime. Current installers use the bootstrapper flow instead of bundling the full runtime.

### Windows prerequisites

For local development on Windows, install:

- Microsoft C++ Build Tools with the `Desktop development with C++` workload
- Windows 10/11 SDK (`rc.exe` must be available)
- Microsoft Edge WebView2 Runtime

These are machine-level prerequisites. The repository scripts can use portable Node/Rust toolchains.

### Portable toolchains

The shared workflow runner looks for portable dependencies in this order:

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

This keeps the repo team-friendly: no user-specific paths in the main workflow, and each developer can choose repo-local or external portable toolchains.

## Install

From the repository root:

```bash
git clone https://github.com/F0RLE/Axelate.git
cd Axelate
npm run install-deps
```

`npm run install-deps` installs frontend dependencies into `src/node_modules`.
The root package is only a proxy and should not have its own dependency tree.

## Development

Recommended:

```bash
npm run dev
```

This runs the shared Node workflow, resolves portable tools when available, syncs Specta bindings, and starts Tauri.

Direct commands:

```bash
npm run tauri:dev
npm run verify
```

### What is needed for development on Windows

Machine-level prerequisites:

- Microsoft C++ Build Tools with `Desktop development with C++`
- Windows 10/11 SDK
- Microsoft Edge WebView2 Runtime

Portable or local prerequisites:

- Node.js 20+
- npm 10+
- Rust stable

The repository scripts support portable Node/Rust toolchains, but they still expect the Windows-native SDK and MSVC toolchain to exist on the machine.

## Build

From the repository root:

```bash
npm run build
npm run tauri:build
npm run release
```

`npm run build` builds the frontend only.
`npm run tauri:build` builds the desktop application.
`npm run release` runs the repository verification pipeline first, then creates the Tauri release bundle.

### What is needed for release builds on Windows

Release builds use the same prerequisites as development:

- Microsoft C++ Build Tools
- Windows SDK
- WebView2 Runtime
- Node.js / npm
- Rust stable

Current bundle targets are `msi` and `nsis`, so the Windows toolchain must stay available during release packaging.

### Current repository status

The local Windows environment is ready when `npm run verify` succeeds.
If `npm run release` still fails, the remaining blockers are in repository checks or release packaging details, not in the machine setup.
Run `npm run verify` first and fix any failing tests or lint errors before packaging.

## First launch

Current user flow:

1. open the app
2. go to Settings
3. add the OpenRouter API key
4. select a model
5. optionally install local engines such as `llama.cpp` or `stable-diffusion.cpp`

## Verification

Before release work, run:

```bash
npm run verify
```

This checks:

- `cargo fmt --check`
- `cargo clippy -- -D warnings`
- `cargo check --bins`
- `cargo test --lib`
- frontend typecheck, lint, format check, tests, build, size budget
- `npm run release` for the release-oriented path
- optional legacy release security checks with `pwsh -ExecutionPolicy Bypass -File .\.github\scripts\verify-all.ps1 -IncludeReleaseSecurity`

## Common issues

### WebView2 missing

Install the Microsoft Edge WebView2 Runtime.

### `rc.exe` missing

Install Windows SDK through Visual Studio Build Tools.

### Two `node_modules` folders

That is wrong for this repository. Dependencies should live only in `src/node_modules`.

## Related docs

- [Architecture](architecture.md)
- [Roadmap](ROADMAP.md)
- [Automation](AUTOMATION.md)
- [Coding Standards](CODING_STANDARDS.md)
- [Security Hardening](SECURITY_HARDENING.md)
- [Project Tree](ProjectTree.md)
