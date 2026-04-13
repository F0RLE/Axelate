# Automation

Axelate uses a shared cross-platform workflow runner plus optional platform launchers.

## Main commands

Run all commands from the repository root.

| Command | What it does |
| --- | --- |
| `npm run doctor` | check local development prerequisites |
| `npm run setup` | validate prerequisites, install frontend dependencies, configure hooks |
| `npm run install-deps` | install frontend dependencies into `src/node_modules` |
| `npm run dev` | start the desktop app in development mode |
| `npm run tauri:dev` | start Tauri dev directly |
| `npm run verify` | full verification gate |
| `npm run build` | frontend production build |
| `npm run clear` | remove build artifacts and caches |
| `npm run tauri:build` | desktop production build |
| `npm run release` | verify first, then build the desktop release bundle |
| `npm run clean` | clean build outputs and caches |

## Primary workflow

The main entrypoint is:

```text
.github/scripts/workflow.mjs
```

It is responsible for:

- checking local prerequisites through `doctor`
- preparing the repository through `setup`
- resolving portable Node/Rust toolchains
- adding Windows SDK / MSVC tools when needed
- running root commands in a cross-platform way
- keeping `npm run ...` as the canonical interface

## Optional launchers

Double-click launchers live in:

- `launchers/windows`
- `launchers/macos`
- `launchers/linux`

These are convenience wrappers only.
The kept launcher set is intentionally small:

- `dev.*` for inspect-enabled desktop development
- `build.*` for builds
- `clear.*` for cleanup
- `verify.*` for the full verification gate

## Legacy PowerShell scripts

PowerShell scripts still live in `.github/scripts/`.

They are now helper or compatibility entrypoints, not the primary development interface.

- `common.ps1` - helper functions and Windows bootstrap logic
- `dev.ps1` - legacy development flow
- `verify-all.ps1` - legacy verification flow
- `clear.ps1` - cleanup helper
- `release.ps1` - legacy release helper with checksum and release hardening checks
- `update.ps1` - legacy dependency update helper

## Git hooks

Hooks live in `.github/.husky`.

They use tooling from `src/node_modules`, not from a root npm dependency tree.

Current hooks:

- `pre-commit`
- `commit-msg`

Git hook installation is handled by:

```text
src/scripts/setup-git-hooks.mjs
```

## CI and release

GitHub workflows live in `.github/workflows`.

- `ci.yml` runs the verification pipeline
- `release.yml` uses the official Tauri GitHub Action, release audits, checksum generation, and release hardening checks
