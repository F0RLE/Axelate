# Axelate Architecture

> Practical map of the current repository. Use this before changing backend
> contracts, integrations, runtime lifecycle, or cross-platform behavior.

## Runtime Shape

Axelate is a Tauri 2 desktop app:

- `src/` is the TypeScript frontend.
- `src-tauri/` is the Rust backend and Tauri host.
- Rust commands are exported to TypeScript through Specta bindings in
  `src/shared/types/bindings.ts`.
- The current binding stack is `specta` `2.0.0-rc.25`,
  `tauri-specta` `2.0.0-rc.25`, and `specta-typescript` `0.0.12`.
- Runtime assets, built-in module manifests, and locales live under
  `src-tauri/resources/`.

The frontend should render state and orchestrate user flow. The backend should
own domain rules, filesystem access, secrets, process lifecycle, downloads, and
persisted state.

## Frontend

Important frontend areas:

- `src/app/`: application bootstrap, shell wiring, and top-level events.
- `src/features/`: user-facing feature modules such as chat, AI catalog,
  downloads, console, monitoring, settings, and the home overview placeholder.
- `src/infrastructure/`: adapters for i18n, logging, navigation, and Tauri IPC.
- `src/shared/`: shared API wrappers, shell helpers, UI utilities, config, and
  generated backend types.

Rules for frontend changes:

- Keep user-facing text in `src-tauri/resources/locales/`.
- Call backend commands through the existing Tauri provider and generated
  bindings where available.
- Do not store provider secrets in frontend-owned state.
- Surface provider, engine, module, and download errors through notifications or
  status UI, not as assistant chat messages.

## Backend

Important backend areas:

- `src-tauri/src/api/`: Tauri commands and frontend-facing request/response
  boundaries.
- `src-tauri/src/domain/`: AI, engine, module, integration API, monitoring, and
  system domain logic.
- `src-tauri/src/infrastructure/`: config, filesystem, crypto, logging,
  persistence, and platform adapters.
- `src-tauri/src/models/`: shared data structures exported to the frontend.
- `src-tauri/src/app/`: window, tray, startup, and application lifecycle glue.

Rules for backend changes:

- Keep frontend-facing contracts stable and typed.
- Regenerate bindings after changing exported commands or types.
- Keep OS-specific behavior behind platform adapters or `cfg(...)` gates.
- Prefer typed errors over string-only failures.
- Avoid adding product gates or activation logic unless the real backend system
  exists.

## Integration Runtime

Local integrations are installed modules that can be imported from folders,
archives, repositories, or trusted URLs. The launcher owns:

- install/import flow
- module manifest discovery
- start, stop, status, and cleanup requests
- settings-session tokens for module-owned settings UIs
- local integration API tokens for script-runtime integrations

Current local integrations are code the user chose to run. They are not the same
as reviewed or signed packages yet. Permission prompts, signing, verified
publisher state, and remote managed execution are future layers documented in
the roadmap and trust model.

## Filesystem And Shell Boundaries

Filesystem and shell access should remain backend-mediated or policy-checked:

- module ids must be validated before deriving module install, runtime, settings,
  or log paths
- archive extraction must normalize paths and reject traversal, unsupported entry
  types, duplicate entries, and suspicious size patterns
- custom settings UI and runtime entry paths must resolve inside their owning
  module root
- frontend external URL opening must use the shared URL policy instead of direct
  shell calls
- local folders should be opened through backend commands that validate the
  target first

When adding a new feature that touches files, URLs, processes, or shell-open,
start by deciding which component owns validation and add a targeted test for
that boundary.

## Contracts

Use this sequence when changing a frontend-visible backend contract:

1. Update Rust command/type definitions.
2. Run `npm --prefix src run bindings:sync`.
3. Update TypeScript callers.
4. Run `npm --prefix src run typecheck`.

If bindings are out of date, `npm --prefix src run bindings:check` should fail.

Dynamic JSON fields such as provider payloads, module settings, config schemas,
and chat content are exported as TypeScript `unknown`. Treat that as an
intentional trust boundary: narrow the value at the frontend use site, or replace
the Rust field with a typed DTO when the shape becomes stable.

## Cross-Platform Rule

The app is Windows-first today, but new architecture should keep Linux and macOS
viable:

- avoid hardcoded path separators and drive-letter assumptions
- avoid `.exe` assumptions outside platform-specific code
- model GitHub release parsing by OS, architecture, accelerator, and archive
  format
- degrade unavailable platform features in the UI instead of failing late

## Related Docs

- [Getting Started](GETTING_STARTED.md)
- [User Guide](USER_GUIDE.md)
- [Development Workflow](DEVELOPMENT_WORKFLOW.md)
- [Integration API](INTEGRATION_API.md)
- [Agent Control](AGENT_CONTROL.md)
- [Integration Development](INTEGRATION_DEVELOPMENT.md)
- [Custom Integrations](CUSTOM_INTEGRATIONS.md)
- [Trust Model](TRUST_MODEL.md)
