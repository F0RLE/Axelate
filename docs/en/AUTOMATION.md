# Automation

Axelate uses root proxy scripts plus PowerShell automation under `.github/scripts`.

## Main commands

Run all commands from the repository root.

| Command | What it does |
| --- | --- |
| `npm run install-deps` | install frontend dependencies into `src/node_modules` |
| `npm run dev` | run the PowerShell dev flow |
| `npm run tauri:dev` | start Tauri dev directly |
| `npm run verify-all` | full verification gate |
| `npm run build` | frontend production build |
| `npm run tauri:build` | desktop production build |
| `npm run clean` | clean build outputs and caches |

## PowerShell scripts

Scripts live in `.github/scripts/`.

### `common.ps1`

Shared helpers:

- path setup
- command execution
- Windows SDK discovery
- frontend dependency check
- Specta binding sync

### `dev.ps1`

The development entrypoint used by `npm run dev`.

Current behavior:

1. check required tools
2. find Windows SDK when needed
3. install frontend dependencies if missing
4. sync Rust to TypeScript bindings
5. format frontend files
6. start Tauri dev

### `verify-all.ps1`

The release gate.

Current order:

1. `cargo fmt --check`
2. `cargo clippy -- -D warnings`
3. `cargo check --bins --verbose`
4. `cargo test --lib --verbose`
5. `npm ci` in `src`
6. Specta binding sync
7. frontend typecheck, lint, format check, tests
8. frontend build
9. size-budget check

### Other scripts

- `clear.ps1` - cleanup
- `release.ps1` - release helper
- `update.ps1` - update helper

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
- `release.yml` uses the official Tauri GitHub Action for releases
