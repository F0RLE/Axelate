# Axelate Agent Notes

## Project Shape
- Axelate is a desktop AI launcher/workstation built with Tauri 2.
- Frontend lives in `src/`: TypeScript, Vite, Vitest, ESLint, Prettier, plain DOM/CSS UI modules, Tauri JS API, Specta-generated backend bindings.
- Backend lives in `src-tauri/`: Rust 2024, Tauri commands, Tokio async runtime, Reqwest networking, Specta/Tauri Specta bindings, JSON/TOML persistence, tracing logs.
- Runtime modules and launcher assets live under `src-tauri/resources/`; generated frontend output lives under `src/dist/`.
- Root `package.json` is a workflow proxy. Most frontend commands run through `npm --prefix src ...`; Rust commands use `src-tauri/Cargo.toml`.

## Verification
- Prefer targeted checks while iterating:
  - Frontend tests: `npm --prefix src run test -- --run <test files>`
  - Frontend typecheck: `npm --prefix src run typecheck`
  - Backend tests: `cargo test --manifest-path src-tauri/Cargo.toml`
  - Backend targeted tests: `cargo test --manifest-path src-tauri/Cargo.toml <filter> --lib`
- Before larger commits, run the smallest meaningful frontend and backend checks for the touched surface.
- `check-size` is informational for this desktop app; do not treat bundle size as a primary design constraint unless CI or release policy explicitly requires it.

## Frontend Notes
- Reuse existing feature/controller/service boundaries instead of adding global shortcuts or one-off DOM patches.
- Keep UI text in I18n resources under `src-tauri/resources/locales/`; do not hardcode Russian or English user-facing strings in TS/HTML.
- Errors from providers, modules, downloads, and engines should surface as notifications/status UI, not as assistant chat messages unless they are actual model responses.
- Shared Tauri IPC access should go through existing provider/service wrappers and generated bindings where available.
- Do not rely on browser preview behavior as product behavior; the shipped runtime is the Tauri webview.

## Backend Notes
- Keep API command modules in `src-tauri/src/api/`, domain logic in `src-tauri/src/domain/`, and filesystem/config/crypto/system adapters in `src-tauri/src/infrastructure/`.
- Preserve strict Rust lint policy: avoid `unwrap`, `expect`, `panic`, `todo`, and unchecked indexing in production code.
- Prefer typed errors/results over stringly-typed failures. Frontend-facing errors should remain stable enough for UI handling and tests.
- Keep Specta bindings synchronized when command request/response types change: `npm --prefix src run bindings:sync`.

## Cross-Platform Direction
- The app is currently Windows-first, but new work should keep Windows, Linux, and macOS viable unless a feature is explicitly Windows-only.
- Put OS-specific code behind Rust `cfg(...)` gates or small platform adapters. Avoid scattering Windows assumptions through domain logic.
- Avoid hardcoded path separators, drive-letter assumptions, shell-specific commands, and `.exe`-only binary names outside platform-specific code.
- External engine/module release parsing must account for OS and architecture explicitly: Windows/Linux/macOS, x64/arm64/x86, archive formats, checksums, and GitHub release URL variants.
- Current Windows-specific areas include bundling (`msi`/`nsis`, WebView2), WMI/windows APIs, Windows speech recognition, process/window integration, and some engine binary expectations. Treat these as adaptation points when adding other platforms.
- When adding a feature that cannot work cross-platform yet, expose it as a capability check and degrade cleanly in UI rather than failing late.

## Git Hygiene
- Do not commit generated dependency folders such as `src/node_modules/`.
- Do not edit `src/dist/` unless the task is specifically about generated build output.
- Keep commits scoped to one behavior area where possible: frontend UI, backend core/API, release parsing, settings persistence, etc.
