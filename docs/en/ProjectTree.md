# Project Tree

This is a maintained overview, not an exhaustive dump of every file.

```text
Axelate/
|-- .github/
|   |-- .husky/        git hooks
|   |-- scripts/       legacy PowerShell helpers
|   `-- workflows/     CI and release workflows
|-- docs/
|   |-- en/            English docs
|   |-- ru/            Russian docs
|   `-- zh/            Chinese docs
|-- launchers/
|   |-- windows/       double-click launchers for Windows
|   |-- macos/         double-click launchers for macOS
|   `-- linux/         double-click launchers for Linux
|-- scripts/
|   `-- workflow.mjs   shared cross-platform task runner
|-- src/
|   |-- app/           frontend startup and composition
|   |-- assets/        icons, logos, fonts
|   |-- features/      ai, chat, settings, downloads, monitoring, console, home-overview
|   |-- infrastructure/ frontend adapters such as i18n and navigation
|   |-- public/        static frontend assets
|   |-- scripts/       frontend maintenance scripts
|   |-- shared/        shared services, shell UI, types, utils
|   |-- styles/        CSS
|   `-- test/          test helpers and integration tests
|-- src-tauri/
|   |-- src/
|   |   |-- api/       Tauri command adapters
|   |   |-- app/       backend wiring
|   |   |-- bin/       helper binaries
|   |   |-- domain/    core business logic
|   |   |-- infrastructure/
|   |   |-- models/
|   |   `-- utils/
|   |-- resources/     locales, config, assets
|   `-- tauri.conf.json
|-- package.json       root task entrypoints
`-- README.md
```

## Notes

- frontend dependencies live in `src/node_modules`
- the root package does not own a second dependency tree
- generated TypeScript bindings are emitted from Rust and belong under `src/shared/types/`
- `launchers/` is optional convenience only; the canonical interface is still `npm run ...`
