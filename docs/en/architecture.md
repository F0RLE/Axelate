# Architecture

This document describes the current repository shape and the runtime boundaries that matter.

## Core posture

- Rust owns domain logic, security-sensitive state, and shared contracts.
- TypeScript owns desktop UI composition and view orchestration.
- Specta-generated bindings are the Rust to TypeScript contract.
- Tauri commands stay thin and should not absorb business logic.
- Optional integrations must stay behind adapters so the core still works without them.

## Top-level shape

```text
Axelate/
├── .github/     workflows, hook runner, shared workflow scripts
├── docs/        project documentation
├── src/         frontend app
├── src-tauri/   Rust backend and Tauri setup
└── package.json root task proxy
```

## Frontend

```text
src/
├── app/             startup, composition, bridge wiring
├── assets/          icons, logos, fonts
├── features/        ai, chat, settings, downloads, monitoring, console
├── infrastructure/  adapters such as i18n, navigation, tauri provider
├── public/          static templates
├── scripts/         frontend maintenance scripts
├── shared/          shell UI, shared services, types, utilities
├── styles/          global and feature CSS
└── test/            test helpers and integration coverage
```

Frontend rules:

- DOM updates stay explicit.
- Business logic stays outside UI classes.
- Shared shell behavior should be reusable, not copied between features.
- Sanitization is mandatory for rendered rich content.
- TypeScript does not redefine Rust-owned contracts by hand.

## Backend

```text
src-tauri/src/
├── api/             Tauri command adapters
├── app/             backend bootstrap and app wiring
├── bin/             helper binaries such as the Specta exporter
├── domain/          business logic
├── infrastructure/  http, config, crypto, logging, system glue
├── models/          shared data models
└── utils/           narrow utility helpers
```

Backend rules:

- Async code must not block.
- Domain modules should stay readable and task-focused.
- Infrastructure code should serve the domain, not leak into it.
- Errors should stay explicit and typed.

## Runtime flow

### App startup

1. Tauri boots the Rust backend.
2. Startup checks and app state initialization run on the Rust side.
3. The frontend creates the core container and service graph.
4. Specta bindings define the frontend-visible contract.
5. UI modules subscribe to backend events and local services.

### Chat flow

1. The frontend builds the request and active UI state.
2. The request crosses the Tauri bridge.
3. Rust resolves the active provider, settings, credentials, and session context.
4. Streaming responses are emitted back to the frontend.
5. The frontend only renders events for the active request id.

### Local engine flow

1. The frontend asks to install, start, stop, or inspect a module.
2. Rust probes hardware and resolves the best compatible asset.
3. Downloads are verified and extracted safely.
4. Engine lifecycle logic starts the process on a safe localhost port.
5. The frontend reads state from backend-owned status rather than inventing ports or paths.

## Ownership boundaries

- Rust is the source of truth for shared types and secure values.
- The frontend mostly owns presentation state, orchestration, and user interaction.
- Module lifecycle, provider routing, and hardware-aware decisions belong on the backend side.

## High-value subsystems

### AI

- cloud chat routing
- local engine routing
- request/session orchestration
- streaming transport isolation

### Modules

- GitHub release discovery
- hardware-aware bundle selection
- safe extraction and staging
- process lifecycle management

### Shell

- window management
- navigation history
- sidebar and modal orchestration
- console, downloads, and settings surfaces

## Build and verification

The main local gate is:

```bash
npm run verify
```

That gate is driven by the shared runner in `.github/scripts/workflow.mjs` and covers Rust checks, frontend checks, build output validation, and size checks.
