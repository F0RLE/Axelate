# Project Tree

This is the maintained high-signal tree, not a raw file dump.

```text
Axelate/
├── .github/
│   ├── .husky/        git hooks
│   ├── scripts/       shared workflow and helper scripts
│   └── workflows/     CI and release workflows
├── docs/
│   ├── en/            English docs
│   ├── ru/            Russian docs
│   └── zh/            Chinese docs
├── src/
│   ├── app/           startup, composition, bridge wiring
│   ├── assets/        icons, logos, fonts
│   ├── features/      ai, chat, settings, downloads, monitoring, console
│   ├── infrastructure/ frontend adapters
│   ├── public/        static templates and assets
│   ├── scripts/       frontend maintenance scripts
│   ├── shared/        shell UI, services, shared types, helpers
│   ├── styles/        global and feature CSS
│   └── test/          test helpers and integration coverage
├── src-tauri/
│   ├── resources/     locales and bundled resources
│   ├── src/
│   │   ├── api/       Tauri command adapters
│   │   ├── app/       backend bootstrap
│   │   ├── bin/       helper binaries
│   │   ├── domain/    business logic
│   │   ├── infrastructure/
│   │   ├── models/
│   │   └── utils/
│   └── tauri.conf.json
├── package.json       root task proxy
└── README.md
```

## Notes

- Frontend dependencies live in `src/node_modules`.
- The root package does not own a separate dependency tree.
- Specta-generated bindings are emitted into `src/shared/types/`.
- The shared root workflow runner lives in `.github/scripts/workflow.mjs`.
- Rust owns backend contracts; TypeScript consumes them.
