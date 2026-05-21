# Contributing to Axelate

Use these documents first:

- [Getting Started](docs/localization/en/GETTING_STARTED.md)
- [Development Workflow](docs/localization/en/DEVELOPMENT_WORKFLOW.md)
- [Releases](docs/localization/en/RELEASES.md)
- [Current State](docs/localization/en/CURRENT_STATE.md)

## Working Rules

- Run repository commands from the repository root.
- Use `npm run setup` for first-time setup.
- The root `package.json` is a task runner, not a place for a root `node_modules` tree.
- Frontend dependencies belong in `src/node_modules`.
- Rust types are the source of truth for generated frontend bindings.
- Keep generated output out of Git: `src-tauri/gen`, `src-tauri/target`, `src/dist`, `src/coverage`, and `src/.axelate` are disposable.

## Branches

- Use `nightly` for active development.
- Keep `main` release-ready.
- Send dependency update work to `nightly`.
- Create release tags only from commits that are ready to ship.
- Use squash merge for pull requests. Merge commits and rebase merges are disabled in the repository settings.

## Before Opening A PR

- Run `npm run verify`.
- If you changed Rust types exported to the frontend, run `npm run bindings:sync`.
- Keep commit messages in Conventional Commits format. `npm run setup` installs Git hooks that enforce this.
- Expect GitHub `Strict CI` and CodeRabbit on pull requests targeting `main` or `nightly`.
- Expect `Dependency Review` only when npm or Cargo dependency files change.
- The protected branches do not require a second human approval right now because the project is maintained by a solo owner.

## Repository Automation

- `Strict CI` is the required merge gate for protected branches.
- `CodeQL`, `Dependency Review`, and scheduled `Security Audit` workflows provide additional security coverage without blocking every normal PR.
- CodeRabbit reviews pull requests against `nightly` and `main`; its feedback is advisory unless a concrete bug or risk is confirmed.
- Dependabot security and dependency update pull requests target `nightly`.
- Secret scanning and push protection are enabled in GitHub repository settings.

## Releases

- Read [Releases](docs/localization/en/RELEASES.md) before tagging.
- Tags must start with `v`.
- Tag versions must match `package.json`, `src/package.json`, and `src-tauri/Cargo.toml`.
- Release tags must point to a commit that is already reachable from `main`.
- Release tags matching `v*` are protected against deletion and non-fast-forward updates.
- Pushing a matching `v*` tag triggers the GitHub release workflow.

## Docs Policy

These files should describe the repository as it works today:

- `README.md`
- `docs/localization/en/GETTING_STARTED.md`
- `docs/localization/en/DEVELOPMENT_WORKFLOW.md`
- `docs/localization/en/RELEASES.md`
- `docs/localization/en/CURRENT_STATE.md`
- `docs/localization/en/TRUST_MODEL.md`

These files are planning documents and should not be used as current feature inventory:

- `docs/localization/en/VISION.md`
- `docs/localization/en/ROADMAP.md`

Move future ideas into the planning documents instead of mixing them into current onboarding docs.
