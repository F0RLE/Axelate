# Axelate Development Workflow

> Current contributor workflow for working on the repository today.
> Use this document for day-to-day development, not for future product planning.

## Working Model

- run commands from the repository root
- use the root `package.json` as the canonical task runner
- keep frontend dependencies in `src/node_modules`
- treat Rust types as the source of truth for frontend-visible bindings

Branch model:

- `nightly` is the active development branch
- `main` is the release-ready branch
- dependency update pull requests target `nightly`
- merge to `main` only after CI is green and the change is ready to release
- protected branches require strict frontend/backend checks, linear history, resolved conversations, and no force-push or deletion
- protected branches currently do not require a second human approval because the repository is in a solo-maintainer phase
- pull requests use squash merge; merge commits and rebase merges are disabled

The repository currently splits responsibilities this way:

- `.github/scripts/workflow.mjs`: root task runner for setup, dev, build, release, and verification
- `src/`: vanilla TypeScript frontend, shell, tests, and frontend tooling
- `src-tauri/`: Rust backend, domain logic, secure state, and build pipeline
- `docs/localization/en/`: current English docs plus separate planning docs

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

## Manual Smoke Check

Before merging a large PR to `nightly` or promoting `nightly` toward `main`, run
the smallest manual desktop pass that touches the real Tauri runtime:

- startup and shutdown: launch with `npm run dev`, close the app, relaunch, and
  confirm the previous UI state restores without stale modals or stuck loading
  states
- chat text flow: send a normal message, cancel a streaming response, retry or
  regenerate the last turn, and confirm provider errors appear as toasts rather
  than persistent assistant messages
- chat image flow: send an image-generation request, cancel one in progress, and
  confirm generated images restore from history with image actions intact
- provider settings: save, validate, remove, and relaunch after deleting an API
  key; the key should stay removed after restart
- local modules: open version selection, download a CPU or GPU package, start,
  stop, restart, remove, and confirm the selection modal refreshes after disk
  changes
- integrations: import a folder or archive, run it, open settings, delete it
  from the launcher, then delete or restore the folder externally and confirm
  the integrations modal refreshes
- console and downloads: filter log levels, pause/resume/cancel an active
  download, and confirm controls stay clickable under hover

If one of these checks fails, fix the product flow first and only update docs if
the intended behavior changed.

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

## Automation, CI, And Releases

GitHub Actions currently has these repository workflows:

- `Strict CI`: runs on pushes and pull requests for `main` and `nightly`, plus manual dispatch
- `CodeQL`: runs code scanning for TypeScript/JavaScript and Rust on pushes to `main` or `nightly`, weekly schedule, and manual dispatch
- `Dependency Review`: reviews dependency changes on pull requests to `main` and `nightly` when npm or Cargo dependency files change
- `Security Audit`: runs scheduled and manual `npm audit` plus `cargo audit`
- `Release Build`: runs on pushed `v*` tags, plus manual dispatch for an existing tag

Protected branches require the `Frontend Strict Check` and `Backend Strict Check` jobs from `Strict CI`.
CodeRabbit is the normal advisory review signal on pull requests.
CodeQL and scheduled security audits run outside the normal PR path to avoid slowing down solo development.

The release workflow builds the Windows Tauri bundles, verifies release hardening, writes `SHA256SUMS.txt`, and attaches checksums to the GitHub release.
The release tag must match the versions in `package.json`, `src/package.json`, and `src-tauri/Cargo.toml`.

See [Releases](RELEASES.md) for the release checklist.

Repository review automation:

- CodeRabbit reviews pull requests targeting `nightly` and `main`
- CodeRabbit is configured for a low-noise solo-maintainer workflow and should prioritize correctness, security, data loss, user-flow regressions, and missing tests
- CodeRabbit labeling is advisory; labels are not auto-applied
- generated bindings, lockfiles, build output, caches, and dependency directories are excluded from CodeRabbit review noise where configured
- GitHub secret scanning, push protection, Dependabot alerts, and Dependabot security updates are enabled in repository settings

Cleanup command:

```bash
npm run clear
npm run clear -- --deep
```

- `clear`: removes generated build output and caches
- `clear -- --deep`: also removes `src/node_modules`

Repository hygiene:

- do not commit `src/node_modules`, `src/dist`, `src/coverage`, `src/.axelate`, `src-tauri/target`, or `src-tauri/gen`
- do not add the frontend package as a `file:` dependency of itself
- keep generated Rust-to-TypeScript bindings tracked only where the exporter writes source contracts under `src/`
- keep Tauri schema output under `src-tauri/gen` ignored and disposable

## Generated Bindings

Frontend bindings are generated from Rust. The intended workflow is:

- change the Rust type first
- run `npm run bindings:sync` when you need to refresh generated bindings manually
- rely on `npm run dev`, `npm run tauri:build`, and `npm run release` to sync bindings automatically
- rely on `npm run bindings:check`, `npm run typecheck`, and `npm run verify` for read-only validation

If bindings are out of date, `typecheck` and `verify` should fail instead of silently rewriting files.

Current Specta policy:

- the binding stack is `specta` `2.0.0-rc.25`, `tauri-specta` `2.0.0-rc.25`, and `specta-typescript` `0.0.12`
- `serde_json::Value` is exported to TypeScript as `unknown` because it is dynamic JSON, not a stable typed contract
- Rust integer shapes that cross the Tauri JSON boundary are exported as TypeScript `number`; do not introduce frontend `bigint` unless the IPC path is changed deliberately
- floating-point DTO fields use lossless-float generation so metrics and settings remain typed as numbers on the frontend
- validate binding changes with `npm run bindings:check`, `npm run typecheck`, and the smallest relevant Rust/frontend tests

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

- [User Guide](USER_GUIDE.md)
- [Getting Started](GETTING_STARTED.md)
- [Architecture](ARCHITECTURE.md)
- [Releases](RELEASES.md)
- [Current State](CURRENT_STATE.md)
- [Trust Model](TRUST_MODEL.md)
- [Agent Control](AGENT_CONTROL.md)

Use these as planning-only documents:

- [Vision](VISION.md)
- [Roadmap](ROADMAP.md)

If a statement is not true in the repository today, it should not live in the onboarding docs.

When changing behavior, update docs in the same scope:

- command, setup, or release behavior: update `GETTING_STARTED`,
  `DEVELOPMENT_WORKFLOW`, or `RELEASES`
- frontend/backend contracts: update `ARCHITECTURE` and regenerate/check
  bindings
- integration runtime behavior: update `INTEGRATION_API`,
  `INTEGRATION_DEVELOPMENT`, and `CUSTOM_INTEGRATIONS`
- agent API behavior: update `AGENT_CONTROL`, `INTEGRATION_API`, and
  `TRUST_MODEL`
- secrets, filesystem, shell, process, token, or permission behavior outside
  Agent Control: update `TRUST_MODEL` and the relevant user/developer guide
- future product direction only: update `VISION` or `ROADMAP`, not current-state
  onboarding docs
