# Architecture

This document describes the current codebase structure and runtime flow.

## Principles

- Rust owns domain logic and shared types
- TypeScript is the UI shell and orchestration layer
- Specta generates Rust to TypeScript bindings
- Tauri command adapters stay thin
- optional external systems stay behind adapters

## Top-level structure

```text
Axelate/
├── src/
├── src-tauri/
├── .github/
├── launchers/
├── docs/
└── .github/
```

## Frontend structure

```text
src/
├── app/             app startup and composition
├── features/        feature modules such as ai, chat, settings, monitoring
├── infrastructure/  technical adapters such as i18n and navigation
├── shared/          shared services, shell UI, types, utils
├── styles/          CSS
├── scripts/         frontend maintenance scripts
└── test/            test helpers and integration tests
```

Frontend rules:

- DOM work stays in UI classes
- business logic stays in services/controllers
- rendered HTML must be sanitized
- generated bindings come from Rust, not from hand-written TypeScript copies

## Backend structure

```text
src-tauri/src/
├── api/             Tauri command adapters
├── app/             backend app wiring
├── bin/             helper binaries such as the Specta exporter
├── domain/          business logic
├── infrastructure/  filesystem, crypto, http, logging, system glue
├── models/          shared data structures
└── utils/           small helpers
```

Backend rules:

- async code must not block
- domain logic should not depend on UI concerns
- infrastructure details stay outside domain where practical
- errors should stay explicit and typed

## Runtime flow

### App startup

1. Tauri starts the Rust backend
2. startup checks run
3. frontend boot code creates the application container
4. Specta-generated bindings define the TypeScript contract
5. UI subscribes to backend events and services

### Chat flow

1. frontend builds the chat request
2. request goes through the Tauri bridge
3. backend resolves settings and secure credentials
4. backend streams the response
5. frontend renders only events for the active request id

### Local engine flow

1. frontend asks to install or start a module
2. backend probes hardware
3. backend selects the best compatible GitHub release asset
4. downloader verifies digest and extracts into staging
5. manager starts the engine on a free localhost port
6. frontend uses the active endpoint from backend state

The user does not choose engine ports manually.

## Data ownership

- Rust types are the source of truth
- secure values are stored on the backend side
- frontend state is mostly view state and request orchestration

## Important subsystems

### AI

- OpenRouter-backed cloud chat
- local engine routing
- streaming transport with request isolation

### Modules

- GitHub release discovery
- hardware-aware asset selection
- safe archive extraction
- process lifecycle management

### System

- startup checks
- logs
- hardware probing across supported platforms

## Build and verification

Project verification is centered around:

- root scripts in `package.json`
- the shared runner in `.github/scripts/workflow.mjs`
- optional launchers in `launchers/`
- legacy PowerShell helpers in `.github/scripts`
- GitHub workflows in `.github/workflows`

The main gate is:

```bash
npm run verify
```
