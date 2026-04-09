# Axelate

Axelate is a desktop launcher for AI workflows built with Rust, Tauri v2, and vanilla TypeScript.
Right now the project focuses on three things:

- chat through OpenRouter
- local engine management for `llama.cpp` and `stable-diffusion.cpp`
- secure local storage and native desktop integration

## Current stack

- backend: Rust + Tokio + Tauri v2
- frontend: vanilla TypeScript + Vite
- type bridge: Specta
- local HTTP/SSE: Axum

## Repository layout

```text
Axelate/
├── src/         frontend app and all npm dependencies
├── src-tauri/   Rust backend, Tauri config, exporter binary
├── docs/        project documentation
└── .github/     scripts, workflows, git hooks
```

`src/` is the only npm project with real dependencies. The root `package.json` is only a proxy for convenience.

## Developer setup

### Requirements

- Node.js 20+
- npm 10+
- Rust stable
- Windows: Visual Studio Build Tools + Windows SDK

### Install

```bash
git clone https://github.com/F0RLE/Axelate.git
cd Axelate
npm run install-deps
```

### Run in development

```bash
npm run dev
```

Useful root commands:

- `npm run dev` - start the full desktop app in dev mode
- `npm run tauri:dev` - run Tauri dev directly
- `npm run verify-all` - full project verification gate
- `npm run build` - frontend production build
- `npm run tauri:build` - desktop production build

## Notes

- Rust types are the source of truth. TypeScript bindings are generated from Rust.
- The backend chooses a free localhost port for local engines automatically.
- Frontend dependencies live in `src/node_modules` only.

## Docs

- [Getting Started](docs/en/getting-started.md)
- [Architecture](docs/en/architecture.md)
- [Automation](docs/en/AUTOMATION.md)
- [Coding Standards](docs/en/CODING_STANDARDS.md)
- [File Tree](docs/en/FileTree.md)
- [Русское описание проекта](docs/ru/VISION.md)
- [中文简介](docs/zh/README_CN.md)
