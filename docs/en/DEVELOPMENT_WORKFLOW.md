# Axelate Development Workflow

> Current contributor workflow for working on the repository today.
> Use this document for day-to-day development, not for future product planning.

## Working Model

- run commands from the repository root
- use the root `package.json` as the canonical task runner
- keep frontend dependencies in `src/node_modules`
- treat Rust types as the source of truth for frontend-visible bindings

The repository currently splits responsibilities this way:

- `.github/scripts/workflow.mjs`: root task runner for setup, dev, build, release, and verification
- `src/`: vanilla TypeScript frontend, shell, tests, and frontend tooling
- `src-tauri/`: Rust backend, domain logic, secure state, and build pipeline
- `docs/en/`: current docs plus separate planning docs

Rust toolchain policy:

- use `rustup`
- follow the version pinned in `rust-toolchain.toml`
- keep `Cargo.toml`, `rust-toolchain.toml`, and CI on the same tested Rust version

## First-Day Setup

From the repository root:

```bash
npm run doctor
npm run setup
npm run dev
```

What this does:

- `doctor` checks Node, npm, Rust, Git, MSVC, `rc.exe`, and WebView2 on Windows
- `setup` reruns prerequisite checks, installs frontend dependencies into `src/node_modules`, and configures Git hooks
- `dev` syncs generated bindings, starts the frontend, and launches the Tauri desktop app

If you use portable Node or Rust, see [Getting Started](GETTING_STARTED.md) for the supported dependency layout.

## Daily Commands

Main development commands:

```bash
npm run dev
npm run dev:inspect
npm run test
npm run lint
npm run typecheck
npm run verify
```

Recommended use:

- `dev`: normal desktop development loop
- `dev:inspect`: desktop development loop with DevTools and remote WebView debugging enabled
- `typecheck`: read-only binding validation plus TypeScript checks
- `verify`: full local release gate before handoff, release work, or a pull request

Current dev-server behavior:

- the Tauri dev flow expects the frontend on `http://localhost:1420`
- if that port is already held by this repository's Vite server, the launcher reuses it
- if that port is held by another process, dev fails with a scoped error instead of an opaque Vite stack trace

Build commands:

```bash
npm run build
npm run tauri:build
npm run release
```

- `build`: typed frontend bundle build
- `tauri:build`: desktop app build
- `release`: full verification plus release bundle build

Cleanup command:

```bash
npm run clear
npm run clear -- --deep
```

- `clear`: removes generated build output and caches
- `clear -- --deep`: also removes `src/node_modules`

## Generated Bindings

Frontend bindings are generated from Rust. The intended workflow is:

- change the Rust type first
- run `npm run bindings:sync` when you need to refresh generated bindings manually
- rely on `npm run dev`, `npm run tauri:build`, and `npm run release` to sync bindings automatically
- rely on `npm run bindings:check`, `npm run typecheck`, and `npm run verify` for read-only validation

If bindings are out of date, `typecheck` and `verify` should fail instead of silently rewriting files.

## Git Hooks

`npm run setup` configures `core.hooksPath` to use `.github/.husky`.

Current hooks:

- `pre-commit`: frontend lint, format check, tests, Rust fmt check, Rust clippy, Rust tests
- `commit-msg`: commitlint with Conventional Commits rules

The hooks are meant to catch obvious regressions before review, not replace `npm run verify`.

## Windows Notes

- install MSVC through the `Desktop development with C++` workload
- install the Windows SDK so `rc.exe` is available
- install Microsoft Edge WebView2 Runtime
- rerun `npm run doctor` after changing machine prerequisites

The current doctor flow checks WebView2 through the Windows registry and resolves the MSVC environment before calling Rust or Cargo.

## Current Docs vs Planning Docs

Use these as current truth:

- [Getting Started](GETTING_STARTED.md)
- [Current State](CURRENT_STATE.md)
- [Trust Model](TRUST_MODEL.md)

Use these as planning-only documents:

- [Vision](VISION.md)
- [Roadmap](ROADMAP.md)

If a statement is not true in the repository today, it should not live in the onboarding docs.
