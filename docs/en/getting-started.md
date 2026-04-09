# Getting Started

This document describes the current repository layout and the commands that actually work today.

## Requirements

- Node.js 20+
- npm 10+
- Rust stable
- Windows: Visual Studio Build Tools and Windows SDK

Tauri on Windows also needs WebView2 at runtime. Current installers use the bootstrapper flow instead of bundling the full runtime.

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

This runs the PowerShell dev script, checks tools, syncs Specta bindings, formats the frontend, and starts Tauri.

Direct commands:

```bash
npm run tauri:dev
npm run verify-all
```

## Build

From the repository root:

```bash
npm run build
npm run tauri:build
```

`npm run build` builds the frontend only.
`npm run tauri:build` builds the desktop application.

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
npm run verify-all
```

This checks:

- `cargo fmt --check`
- `cargo clippy -- -D warnings`
- `cargo check --bins`
- `cargo test --lib`
- frontend typecheck, lint, format check, tests, build, size budget

## Common issues

### WebView2 missing

Install the Microsoft Edge WebView2 Runtime.

### `rc.exe` missing

Install Windows SDK through Visual Studio Build Tools.

### Two `node_modules` folders

That is wrong for this repository. Dependencies should live only in `src/node_modules`.

## Related docs

- [Architecture](architecture.md)
- [Automation](AUTOMATION.md)
- [Coding Standards](CODING_STANDARDS.md)
- [File Tree](FileTree.md)
