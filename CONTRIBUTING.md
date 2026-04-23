# Contributing to Axelate

Use these documents first:

- [Getting Started](docs/en/GETTING_STARTED.md)
- [Development Workflow](docs/en/DEVELOPMENT_WORKFLOW.md)
- [Current State](docs/en/CURRENT_STATE.md)

## Working Rules

- Run repository commands from the repository root.
- Use `npm run setup` for first-time setup.
- The root `package.json` is a task runner, not a place for a root `node_modules` tree.
- Frontend dependencies belong in `src/node_modules`.
- Rust types are the source of truth for generated frontend bindings.

## Before Opening A PR

- Run `npm run verify`.
- If you changed Rust types exported to the frontend, run `npm run bindings:sync`.
- Keep commit messages in Conventional Commits format. `npm run setup` installs Git hooks that enforce this.

## Docs Policy

These files should describe the repository as it works today:

- `README.md`
- `docs/en/GETTING_STARTED.md`
- `docs/en/DEVELOPMENT_WORKFLOW.md`
- `docs/en/CURRENT_STATE.md`
- `docs/en/TRUST_MODEL.md`

These files are planning documents and should not be used as current feature inventory:

- `docs/en/VISION.md`
- `docs/en/ROADMAP.md`

Move future ideas into the planning documents instead of mixing them into current onboarding docs.
