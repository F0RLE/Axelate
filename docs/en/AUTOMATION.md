# Automation

Axelate uses one shared workflow runner. The root `package.json` is the public interface, and `.github/scripts/workflow.mjs` is the implementation.

## Canonical commands

Run commands from the repository root.

| Command                | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `npm run doctor`       | check machine prerequisites                                    |
| `npm run setup`        | validate prerequisites, install frontend deps, configure hooks |
| `npm run dev`          | start the desktop app in development mode                      |
| `npm run build`        | build the frontend bundle                                      |
| `npm run tauri:build`  | build the desktop app                                          |
| `npm run verify`       | run the full local verification gate                           |
| `npm run release`      | verify first, then build release bundles                       |
| `npm run clear`        | remove build outputs and caches                                |
| `npm run lint`         | frontend lint                                                  |
| `npm run format`       | format frontend files                                          |
| `npm run format:check` | verify frontend formatting                                     |
| `npm run test`         | frontend tests                                                 |
| `npm run typecheck`    | frontend type checks                                           |
| `npm run check-size`   | validate frontend bundle budgets                               |
| `npm run update`       | update npm and cargo dependencies, then verify                 |

## Shared workflow runner

Primary entrypoint:

```text
.github/scripts/workflow.mjs
```

It is responsible for:

- prerequisite checks
- portable toolchain resolution
- frontend dependency installation in `src/node_modules`
- Specta binding sync before app/build tasks
- cross-platform command execution
- the full verify gate

## What `verify` really does

`npm run verify` runs:

- `doctor`
- Rust format check
- Rust clippy with warnings denied
- Rust check
- Rust tests
- fresh frontend install with `npm ci`
- frontend format
- frontend typecheck
- frontend lint
- frontend format check
- frontend tests
- frontend build
- frontend size gate

This is the repository’s real local release gate.

## Git hooks

Hooks live in:

```text
.github/.husky
```

Installation is handled by:

```text
src/scripts/setup-git-hooks.mjs
```

Current active hooks:

- `pre-commit`
- `commit-msg`

## CI and release

GitHub workflows live in `.github/workflows`.

- `ci.yml` runs repository verification in CI.
- `release.yml` builds the desktop release path and runs release hardening checks.

## Notes

- Frontend dependencies belong in `src/node_modules`, not at the repo root.
- The root `package.json` is a task proxy, not a second npm workspace.
- Old platform wrapper scripts are no longer part of the main workflow.
