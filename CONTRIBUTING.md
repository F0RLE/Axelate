# Contributing to Axelate

Use these documents first:

- [Getting Started](docs/en/GETTING_STARTED.md)
- [Development Workflow](docs/en/DEVELOPMENT_WORKFLOW.md)
- [Releases](docs/en/RELEASES.md)
- [Current State](docs/en/CURRENT_STATE.md)

## Working Rules

- Run repository commands from the repository root.
- Use `npm run setup` for first-time setup.
- The root `package.json` is a task runner, not a place for a root `node_modules` tree.
- Frontend dependencies belong in `src/node_modules`.
- Rust types are the source of truth for generated frontend bindings.

## Branches

- Use `nightly` for active development.
- Keep `main` release-ready.
- Send dependency update work to `nightly`.
- Create release tags only from commits that are ready to ship.

## Before Opening A PR

- Run `npm run verify`.
- If you changed Rust types exported to the frontend, run `npm run bindings:sync`.
- Keep commit messages in Conventional Commits format. `npm run setup` installs Git hooks that enforce this.
- Expect GitHub `Strict CI` on pull requests targeting `main` or `nightly`.

## Releases

- Read [Releases](docs/en/RELEASES.md) before tagging.
- Tags must start with `v`.
- Tag versions must match `package.json`, `src/package.json`, and `src-tauri/Cargo.toml`.
- Release tags must point to a commit that is already reachable from `main`.
- Pushing a matching `v*` tag triggers the GitHub release workflow.

## Docs Policy

These files should describe the repository as it works today:

- `README.md`
- `docs/en/GETTING_STARTED.md`
- `docs/en/DEVELOPMENT_WORKFLOW.md`
- `docs/en/RELEASES.md`
- `docs/en/CURRENT_STATE.md`
- `docs/en/TRUST_MODEL.md`

These files are planning documents and should not be used as current feature inventory:

- `docs/en/VISION.md`
- `docs/en/ROADMAP.md`

Move future ideas into the planning documents instead of mixing them into current onboarding docs.
