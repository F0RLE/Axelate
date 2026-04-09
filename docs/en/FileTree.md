# File Tree

This is a maintained overview, not an exhaustive dump of every file.

```text
Axelate/
├── .github/
│   ├── .husky/        git hooks
│   ├── scripts/       PowerShell automation
│   └── workflows/     CI and release workflows
├── docs/
│   ├── en/            English docs
│   ├── ru/            Russian docs
│   └── zh/            Chinese docs
├── src/
│   ├── app/           frontend startup and composition
│   ├── assets/        icons, logos, fonts
│   ├── features/      ai, chat, settings, downloads, monitoring, debug, dashboard
│   ├── infrastructure/ frontend adapters such as i18n and navigation
│   ├── public/        static frontend assets
│   ├── scripts/       frontend maintenance scripts
│   ├── shared/        shared services, shell UI, types, utils
│   ├── styles/        CSS
│   └── test/          test helpers and integration tests
├── src-tauri/
│   ├── src/
│   │   ├── api/       Tauri command adapters
│   │   ├── app/       backend wiring
│   │   ├── bin/       helper binaries
│   │   ├── domain/    core business logic
│   │   ├── infrastructure/
│   │   ├── models/
│   │   └── utils/
│   ├── resources/     locales, config, assets
│   └── tauri.conf.json
├── package.json       root proxy scripts
└── README.md
```

## Notes

- frontend dependencies live in `src/node_modules`
- the root package does not own a second dependency tree
- generated TypeScript bindings are emitted from Rust and belong under `src/shared/types/`
