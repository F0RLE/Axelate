# Coding Standards

This document is intentionally short. Code and config files are authoritative when details change.

## Core rules

1. KISS
2. YAGNI
3. SOLID
4. DRY
5. readability over cleverness

## Backend

- Rust is the source of truth for shared contracts
- do not block inside async code
- keep Tauri command adapters thin
- keep domain logic explicit
- prefer typed errors

## Frontend

- vanilla TypeScript only
- DOM updates stay explicit
- business logic stays outside UI classes
- sanitize rendered HTML
- do not hand-maintain Rust mirrored types when Specta already exports them

## Repository rules

- `src/` is the only npm dependency root
- root `package.json` is a proxy only
- generated bindings should be regenerated, not edited by hand
- docs should describe current behavior, not planned behavior

## Project layout expectations

### Frontend

- `app/` for composition and startup
- `features/` for feature slices
- `shared/` for cross-feature code
- `infrastructure/` for technical adapters

### Backend

- `api/` for command adapters
- `domain/` for business logic
- `infrastructure/` for implementation details
- `models/` for shared data

## Verification before merge

Run from the repository root:

```bash
npm run verify-all
```

This is the required gate for the current repository.

## Commits

- one logical change per commit
- conventional commit format
- do not batch unrelated work
