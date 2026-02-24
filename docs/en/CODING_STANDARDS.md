# Axelate Engineering Standards

**Version:** 4.2.0  
**Last Updated:** 2026-02-24  
**Status:** MANDATORY

> This document is the single source of truth for all engineering decisions. Every config value listed here is extracted from the actual project files. If this document and a config file disagree — the config file is authoritative; update this document.

---

## 1. Architecture

### 1.1. Decision Hierarchy

When principles conflict, follow this strict priority:

1. **KISS** — simplest solution that works. Complexity must justify itself.
2. **YAGNI** — do not build what is not needed today.
3. **SOLID** — applied pragmatically. Break SRP before adding unnecessary abstractions.
4. **DRY** — deduplicate knowledge, not code. Identical code in different contexts is fine.

**Tiebreakers:**
- Simplicity > extensibility
- Clarity > abstraction
- Readability > optimization
- Explicit > implicit

### 1.2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend runtime | Rust (edition 2024) | 1.93.0+ |
| Desktop framework | Tauri v2 | 2.9.5 |
| Async runtime | Tokio | 1.49 |
| Local HTTP | Axum | 0.8 |
| Type bridge | Specta + tauri-specta | 2.0.0-rc.20 |
| Frontend | Vanilla TypeScript | 5.9 |
| Bundler | Vite (esbuild + Rollup) | 7.3 |
| Test framework | Vitest (frontend), cargo test (backend) | 4.0 |
| Linting (TS) | ESLint 9 (flat config) | 9.18 |
| Formatting (TS) | Prettier | 3.8 |
| Formatting (Rust) | rustfmt | edition 2024 |
| Linting (Rust) | Clippy (pedantic + nursery) | — |
| Git hooks | Husky + Commitlint | 9.x / 20.x |
| Package manager | npm | `engines: >=20.0.0` |

### 1.3. Project Layout

```
Axelate/
├── src/                           # Frontend (TypeScript + Vite)
│   ├── app/                       # Boot sequence (init, router, events, bridge)
│   ├── features/                  # Feature modules (ai/, chat/, settings/, ...)
│   │   └── {feature}/
│   │       ├── services/          # Feature business logic
│   │       ├── ui/                # Feature UI classes
│   │       ├── types/             # Feature type definitions
│   │       └── index.ts           # Public exports
│   ├── shared/                    # Cross-feature code
│   │   ├── services/              # Shared services (EventBus, StateService, ...)
│   │   ├── components/            # Shared UI (AppUI, SidebarUI, WindowUI)
│   │   ├── ui/                    # Base classes (BaseComponent)
│   │   └── types/                 # Shared types (bindings.ts, coreTypes.ts)
│   ├── infrastructure/            # Technical adapters
│   │   ├── tauri/                 # TauriProvider (IPC abstraction)
│   │   ├── i18n/                  # I18nService + I18nUI
│   │   └── navigation/           # NavigationService + NavigationUI
│   └── styles/                    # CSS (base/, components/, features/, layouts/)
│
├── src-tauri/                     # Backend (Rust)
│   └── src/
│       ├── api/                   # Tauri command adapters (thin, no logic)
│       ├── domain/                # Business logic (services, traits)
│       ├── infrastructure/        # Implementation details (config, http, crypto)
│       ├── models/                # Shared data types
│       ├── utils/                 # Pure utilities (paths, process, memory)
│       ├── errors.rs              # Centralized error types (AppError, IpcError)
│       └── lib.rs                 # App entry, tray, setup
│
└── docs/                          # Documentation (en/, ru/)
```

### 1.4. Dependency Rules

```
api/ ───→ domain/ ───→ models/
  │           │
  │           └─→ infrastructure/ (via traits) ───→ models/
  │
  └─→ models/, errors.rs

Frontend:
  features/ ───→ shared/, infrastructure/
  shared/   ───→ standalone (no feature imports)
  infrastructure/ ───→ standalone
```

**Circular dependencies are prohibited.** Enforce via `verbatimModuleSyntax` and import discipline.

---

## 2. Compiler & Tooling Configuration

### 2.1. TypeScript (`src/tsconfig.json`)

Maximum strictness. Every strict flag enabled. This is non-negotiable.

```jsonc
{
    "compilerOptions": {
        // === Target ===
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "lib": ["ESNext", "DOM", "DOM.Iterable"],

        // === Core Strict Flags ===
        "strict": true,                            // Umbrella for 7 sub-flags
        "noImplicitAny": true,                     // No implicit `any` — force explicit types
        "noImplicitThis": true,                    // No implicit `this` binding
        "useUnknownInCatchVariables": true,         // catch(e) → e: unknown, not any
        "noImplicitReturns": true,                 // Every code path must return
        "noImplicitOverride": true,                // `override` keyword required on subclass methods

        // === Extra Strict Flags (beyond `strict: true`) ===
        "noUnusedLocals": true,                    // Declared but unused variable → error
        "noUnusedParameters": true,                // Unused function parameter → error
        "noUncheckedIndexedAccess": true,           // arr[0] returns T | undefined, not T
        "noPropertyAccessFromIndexSignature": true, // Force obj["key"] for dynamic keys
        "exactOptionalPropertyTypes": true,         // `prop?: string` ≠ `prop: string | undefined`
        "noFallthroughCasesInSwitch": true,         // Require break/return in switch cases
        "allowUnreachableCode": false,              // Dead code → error
        "allowUnusedLabels": false,                 // Unused labels → error

        // === Module System ===
        "verbatimModuleSyntax": true,               // Forces `import type` for type-only imports
        "isolatedModules": true,                    // Required by Vite/esbuild
        "allowImportingTsExtensions": true,         // .ts extensions in imports
        "resolveJsonModule": true,                  // import pkg from './package.json'

        // === Output ===
        "noEmit": true,                             // tsc = type-checker only; Vite bundles
        "declaration": true,                        // Generate .d.ts (IDE support)
        "declarationMap": true,                     // Source maps for .d.ts

        // === Style ===
        "useDefineForClassFields": true,            // ES2022 class field semantics
        "forceConsistentCasingInFileNames": true,   // Prevent case-sensitivity bugs on macOS/Linux
        "skipLibCheck": true,                       // Skip checking node_modules .d.ts (speed)
        "allowJs": false,                           // TypeScript only — no .js source files

        // === Paths ===
        "baseUrl": ".",
        "paths": { "@/*": ["./*"] },                // @/ → src/ root alias
        "types": ["vite/client"]                    // Vite env types
    }
}
```

**Key developer implications:**

| Flag | You must... |
|------|------------|
| `noUncheckedIndexedAccess` | Always check array/map access: `const x = arr[0]; if (x !== undefined)` |
| `exactOptionalPropertyTypes` | Never assign `undefined` to optional props: `{ name?: string }` means absent or string |
| `verbatimModuleSyntax` | Use `import type { Foo }` or `import { type Foo }` for type-only imports |
| `noPropertyAccessFromIndexSignature` | Use `obj["dynamicKey"]` not `obj.dynamicKey` for index signatures |
| `noImplicitOverride` | Add `override` keyword when overriding parent class methods |

### 2.2. ESLint (`src/eslint.config.js`)

Flat config format (ESLint v9). Uses `eslint-config-prettier` to avoid formatting conflicts.

**Ignored:** `dist/`, `node_modules/`, `*.config.*`, `**/bindings.ts`, `test/`, `scripts/`

#### TypeScript Rules

| Rule | Level | Why |
|------|-------|-----|
| `no-explicit-any` | error | Forces `unknown` + type narrowing |
| `no-non-null-assertion` | error | No `!` — handle `null` properly |
| `no-floating-promises` | error | All promises must be awaited or caught |
| `await-thenable` | error | No `await` on non-promises |
| `no-misused-promises` | error | No promises where void expected |
| `require-await` | error | `async` functions must use `await` |
| `only-throw-error` | error | Only `Error` objects can be thrown |
| `consistent-type-imports` | error | `import type` (inline style) enforced |
| `consistent-type-exports` | error | `export type` enforced |
| `no-unused-vars` | error | `_`-prefixed names exempt |

#### General Rules

| Rule | Level |
|------|-------|
| `no-console` | warn (use `logger` instead) |
| `prefer-const` | error |
| `no-var` | error |
| `eqeqeq` | error (`===` always) |
| `curly` | error (braces always) |
| `no-eval`, `no-implied-eval`, `no-new-func` | error |
| `no-param-reassign` | error |
| `prefer-template` | error |

#### Legacy Globals

The config declares ~30 writable globals for backward-compatible HTML `onclick` handlers. **Do not add new entries.** These are being migrated to TypeScript class methods.

### 2.3. Prettier (`src/.prettierrc`)

```json
{
    "semi": true,
    "singleQuote": true,
    "tabWidth": 4,
    "useTabs": false,
    "trailingComma": "all",
    "printWidth": 100,
    "bracketSpacing": true,
    "arrowParens": "always",
    "endOfLine": "lf"
}
```

Run: `npm run format` (auto-fix) · `npm run format:check` (CI gate).

### 2.4. EditorConfig (`.editorconfig`)

| File type | Indent | EOL |
|-----------|--------|-----|
| `*.ts`, `*.js`, `*.css`, `*.html`, `*.rs` | 4 spaces | LF |
| `*.yml`, `*.yaml`, `*.toml` | 2 spaces | LF |
| `*.json` | 4 spaces | LF |
| `*.md` | 2 spaces, trailing whitespace preserved | LF |
| `*.ps1` | 4 spaces, UTF-8 BOM | LF |
| `*.cmd`, `*.bat` | tabs | CRLF |

### 2.5. Rust Formatter (`src-tauri/rustfmt.toml`)

```toml
edition = "2024"
max_width = 100
tab_spaces = 4
newline_style = "Auto"             # Platform-native EOL (Git normalizes)

reorder_imports = true             # Sort imports alphabetically
reorder_modules = true             # Sort mod declarations

use_field_init_shorthand = true    # { name: name } → { name }
use_try_shorthand = true           # .map_err(...)? → ?
```

Run: `cargo fmt` (auto-fix) · `cargo fmt --check` (CI gate).

### 2.6. Clippy & Rust Lints (`Cargo.toml [lints]`)

All lint levels configured in `Cargo.toml` — never via `#[allow]` attributes (except documented exceptions).

#### Safety Denials (compile error)

| Lint | Reason |
|------|--------|
| `unsafe_code` | No unsafe Rust anywhere in this project |
| `clippy::unwrap_used` | Use `?`, `map`/`and_then`, or `if let` |
| `clippy::expect_used` | Same as above — handle the error |
| `clippy::panic` | Never panic in production code |
| `clippy::todo` | No placeholder code in committed code |
| `clippy::unimplemented` | Same — implement or remove |
| `clippy::dbg_macro` | No debug macros in committed code |
| `clippy::clone_on_ref_ptr` | Explicit `Arc::clone(&x)` instead of `x.clone()` |
| `clippy::expl_impl_clone_on_copy` | Don't impl Clone for Copy types |

#### Clippy Groups (warn)

| Group | Description |
|-------|-------------|
| `clippy::pedantic` | Strict but reasonable linting |
| `clippy::nursery` | Emerging lints catching common mistakes |

#### Rust Compiler Lints (deny)

| Lint Group | Level |
|------------|-------|
| `future_incompatible` | deny — catch breaking changes early |
| `nonstandard_style` | deny — enforce naming conventions |
| `rust_2018_idioms` | deny — use modern Rust patterns |
| `rust_2021_compatibility` | deny — forward compat |
| `missing_docs` | warn — document public items |
| `missing_debug_implementations` | warn — derive Debug on public types |

#### Clean Code Warnings

`indexing_slicing`, `print_stdout`, `print_stderr`, `use_debug`, `implicit_clone`, `needless_pass_by_value`, `unnecessary_wraps`, `if_not_else`, `match_same_arms`, `redundant_closure_for_method_calls`, `semicolon_if_nothing_returned`, `string_add_assign`, `type_repetition_in_bounds`, `used_underscore_binding`

**Allowed exceptions:** `#[allow(clippy::...)]` with a `// Reason:` comment on the line above. Required for: Tauri plugin boilerplate, false positives, specta derive macros.

### 2.7. Rust Release Profile (`Cargo.toml [profile.release]`)

```toml
codegen-units   = 1       # Single codegen unit (maximum opt, slower compile)
lto             = true    # Link-Time Optimization (monolithic build)
opt-level       = "s"     # Optimize for size with better perf than "z"
panic           = "abort" # No unwinding — instant crash (smaller binary)
strip           = true    # Remove debug symbols + metadata
incremental     = false   # Clean release (no stale artifacts)
overflow-checks = true    # Integer overflow → panic in release (security > speed)
```

Result: ~0.7 MB binary. Do **not** change these values without measuring the size impact.

### 2.8. Vite Build (`src/vite.config.ts`)

#### Dev Server

| Setting | Value | Reason |
|---------|-------|--------|
| Port | `1420` (strict) | Must match `tauri.conf.json → devUrl` |
| HMR | `ws://localhost:1420` | WebSocket hot reload |
| Proxy | `/api` → `127.0.0.1:3000` | Routes to Axum local server |
| File watcher | `usePolling: true`, ignores `src-tauri/` | Windows FS watcher compatibility |

#### Build Targets

```typescript
target: process.env.TAURI_PLATFORM === 'windows'
    ? 'chrome120'   // WebView2 (Chromium 120+)
    : 'safari15'    // WebKit (macOS)
```

#### Bundle Optimization

| Feature | Value |
|---------|-------|
| Minifier | esbuild (release), none (debug) |
| Source maps | Debug only (`TAURI_DEBUG`) |
| Chunk warning | 1000 KB (desktop apps tolerate larger bundles) |
| `__APP_VERSION__` | Injected from `package.json` version |

**Manual vendor chunks** (cache stability):

```
vendor-marked    → marked, marked-footnote, marked-katex-extension, marked-alert
vendor-katex     → katex
vendor-dompurify → dompurify
```

**Custom plugin — `pruneFontsPlugin`:** Removes all `.ttf` (except `Cubic_11`) and `.woff` fonts at build time. Only `.woff2` files ship.

### 2.9. Tauri Configuration (`src-tauri/tauri.conf.json`)

#### Window

| Setting | Value | Reason |
|---------|-------|--------|
| `decorations` | `false` | Custom titlebar (chromeless) |
| `transparent` | `false` | Performance (no alpha compositing) |
| `backgroundColor` | `#111015` | Prevents white flash during cold start |
| Size | `1400×900` (min: `1000×600`) | Comfortable default |
| `withGlobalTauri` | `false` | APIs via `@tauri-apps/api`, not `window.__TAURI__` |

#### Content Security Policy

```
default-src 'self';
script-src  'self';                                          ← no inline scripts
style-src   'self' 'unsafe-inline' fonts.googleapis.com;     ← Google Fonts
font-src    'self' fonts.gstatic.com;
img-src     'self' data: asset: http://asset.localhost blob:;
connect-src 'self' ipc: http://ipc.localhost https:;         ← AI API calls
base-uri    'self';
```

#### Bundle

| Setting | Value |
|---------|-------|
| Targets | MSI + NSIS (Windows) |
| Resources | `resources/config`, `resources/locales`, `resources/api_providers.json` |
| Identifier | `com.axelate` |

---

## 3. Rust Backend Rules

### 3.1. Error Handling

- All service methods return `Result<T, AppError>` — never `Result<T, String>`
- `?` operator — never `.map_err(|e| e.to_string())`
- `unwrap()`/`expect()` denied at crate level (Clippy lint)
- Tauri commands: thin adapters converting `AppError` → `IpcError`

```rust
// ✅ Good
#[tauri::command]
#[specta::specta]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, IpcError> {
    settings::load(&state.config_dir).map_err(Into::into)
}

// ❌ Bad: logic in command, returns String error
#[tauri::command]
pub async fn get_settings() -> Result<String, String> {
    std::fs::read_to_string("settings.json").map_err(|e| e.to_string())
}
```

### 3.2. Async & Concurrency

- Tokio for all async — never `std::thread::sleep` in async context
- Axum only for local HTTP server (SSE, GPU endpoints)
- Prefer `mpsc` channels over `Mutex`
- Heavy computation → `tokio::task::spawn_blocking`

### 3.3. Type System

- Rust structs = **source of truth** for all shared types
- IPC-facing types derive: `Serialize, Deserialize, specta::Type`
- `#[serde(rename_all = "camelCase")]` for frontend-facing types
- `bindings.ts` auto-generated by tauri-specta — never edit manually
- Add `// @ts-nocheck` to `bindings.ts` header (pre-existing unused vars from codegen)

---

## 4. TypeScript Frontend Rules

### 4.1. Dependency Injection

Services receive dependencies via constructor. Never access `globalThis.__TAURI__` directly.

```typescript
// ✅ Good: TauriProvider via constructor
export class SettingsService {
    constructor(private readonly _tauri: TauriProvider) {}
    async loadSettings(): Promise<AppSettings> {
        return await this._tauri.invoke<AppSettings>('get_settings');
    }
}

// ❌ Bad: direct globalThis access
async loadSettings() {
    return await (globalThis as TGlobalWin).__TAURI__.core.invoke('get_settings');
}
```

### 4.2. Component Lifecycle

UI classes extend `BaseComponent`. Async data views extend `AsyncView<T>`:

```typescript
export abstract class BaseComponent {
    protected _abortController: AbortController | null = null;
    async init(): Promise<void>     // Sets up AbortController, calls onInit()
    destroy(): void                 // Aborts signals, clears caches, calls onDestroy()
    protected abstract onInit(): void | Promise<void>;
    protected abstract onDestroy(): void;
    protected getElement<T>(id: string): T | null;  // Cached DOM lookup
}

// AsyncView renders through DOMPurify.sanitize() automatically
export abstract class AsyncView<T> extends BaseComponent {
    protected abstract fetchData(): Promise<T>;
    protected abstract renderReady(data: T): string;  // Sanitized by render()
}
```

- Event listeners use `{ signal: this._abortController.signal }` for automatic cleanup
- DOM updates via explicit methods — no virtual DOM
- Business logic in `services/`, never in UI classes

### 4.3. Security

| Threat | Rule |
|--------|------|
| XSS | `innerHTML` only with `DOMPurify.sanitize()` or use `textContent` |
| Secrets | API keys via Tauri `secure_storage` — never `localStorage` |
| Injection | No `eval()`, `Function()`, or inline scripts (blocked by CSP) |
| Templates | `TemplateLoader` auto-sanitizes with DOMPurify allow-lists |

**innerHTML rule applies everywhere**, including:
- `renderSimpleFeature()` — i18n strings must be sanitized
- `ModalManager` — SVG template literals must be sanitized
- `GeneralSettingsRenderer` — generated toggle HTML must be sanitized
- `ErrorHandler` — error message toasts must be sanitized (no manual `escapeHtml`)
- `SettingsUI` ICONS — pre-sanitize in constructor, not at each assignment site

### 4.4. Async Rules

- All top-level promises: `.catch()` or `void` prefix
- `try/catch` at operation boundaries, not individual lines
- Errors: `logger.error('[ModuleName] context:', error)`

---

## 5. Service Architecture

### 5.1. Boot Sequence (`src/app/init.ts`)

```
1. TauriProvider           ← native bridge (first, everything depends on it)
2. LoggerService           ← logging (needed by everything below)
   └─ logger.setTransport()  ← wire Tauri invoke path (§4.1, avoids raw __TAURI__)
3. StateService            ← persisted UI state
4. ModuleService, WindowService, I18nService, CatalogService
5. NavigationService       ← routing
6. Feature services        ← MonitoringService, SettingsService
7. UI classes              ← AppUI, SidebarUI, etc.
8. GlobalBridge            ← expose APIs to globalThis (last)
```

### 5.2. Wiring (Core class)

```typescript
this.tauriProvider = new TauriProvider();
this.state = new StateService(this.tauriProvider);
this.monitoringService = new MonitoringService(this.tauriProvider);
this.settingsService = new SettingsService(this.tauriProvider);
this.monitoringUI = new MonitoringUI(this.monitoringService);
```

### 5.3. Singletons

| Service | Export | Reason |
|---------|--------|--------|
| `EventBus` | `eventBus` (singleton) + `EventBus` (class) | Global pub/sub backbone. Class exported for DI testability |
| `LoggerService` | `logger` | Runs before DI is ready |
| `ErrorHandler` | `errorHandler` | Must catch errors from boot |
| `TemplateLoader` | `templateLoader` | Shared HTML loading/caching |

New services: prefer constructor DI over singletons. For `EventBus`, prefer injecting via constructor when testing is a concern.

---

## 6. Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Classes | PascalCase | `AppUI`, `MonitoringService` |
| Interfaces | `I` prefix | `IApp`, `IConfigField` |
| Functions / methods | camelCase | `showToast`, `handleClick` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES`, `GPT_MODELS` |
| Private members | `_` prefix | `_tauri`, `_bindEvents` |
| Event handlers | `handle` / `on` prefix | `handleClick`, `onPageChange` |
| Booleans | `is` / `has` / `should` | `isValid`, `hasAccess` |
| Files (classes) | PascalCase | `AppUI.ts`, `EventBus.ts` |
| Files (types) | camelCase + Types | `coreTypes.ts`, `aiTypes.ts` |
| CSS classes | kebab-case | `toast-container`, `model-card` |
| Rust functions | snake_case | `get_settings`, `save_ui_state` |
| Tauri commands | verb_noun | `get_*`, `set_*`, `start_*`, `stop_*` |
| Event names | `domain:action` | `page:change`, `module:download:complete` |

---

## 7. CSS

### 7.1. Design Tokens

All visual values via CSS custom properties. No hardcoded colors, spacing, or radii.

```css
/* ✅ */ .card { background: var(--surface); border-radius: var(--radius-md); }
/* ❌ */ .card { background: #1a1a2e; border-radius: 8px; }
```

### 7.2. Naming (BEM-inspired)

```css
.toast-container { }    /* Block */
.toast-content { }      /* Element */
.toast.success { }      /* Modifier */
```

### 7.3. Animations

- Only `transform` and `opacity` (GPU-composited, no reflow)
- UI transitions: 150–300ms
- Page transitions: 300–500ms
- Respect `@media (prefers-reduced-motion: reduce)`

---

## 8. Logging

Format: `[ModuleName] message`

```typescript
logger.info('[MonitoringService] Started listening to system_stats');
logger.error('[SettingsService] Failed to load:', error);
```

| Level | Use for |
|-------|---------|
| `debug` | Internal flow details (filtered in production) |
| `info` | Lifecycle events — init, ready, connected |
| `warn` | Recoverable issues — fallbacks, retries |
| `error` | Failures requiring attention |

Rules:
- Use `logger` — not raw `console.*` (ESLint warns)
- Never log secrets (API keys, tokens)
- Backend: `tracing::` macros (`tracing::info!`, `tracing::error!`, etc.), same semantics

---

## 9. Event System

### 9.1. Frontend EventBus

- Names: `domain:action` (`page:change`, `module:download:complete`)
- Always unsubscribe in `destroy()` / `onDestroy()`
- Types: `IEventBusEvents` interface for compile-time safety

### 9.2. Tauri Events

- Use `TauriProvider.listen<T>()` — never raw `__TAURI__.event.listen()`
- Store `UnlistenFn` and call in cleanup

---

## 10. Internationalization

### 10.1. Keys

Format: `domain.component.element` with fallback:

```typescript
globalThis.t('ui.launcher.module.download', 'Download');
```

### 10.2. Rules

- Always provide fallback string (second argument)
- Static text: `data-i18n` HTML attribute
- `I18nService` handles locale loading and DOM traversal

---

## 11. Testing

### 11.1. Pattern (AAA)

```typescript
describe('ServiceName', () => {
    describe('method', () => {
        it('should do X when Y', () => {
            const input = createTestInput();       // Arrange
            const result = service.method(input);   // Act
            expect(result).toBe(expected);          // Assert
        });
    });
});
```

### 11.2. Coverage Targets (Vite config)

| Category | Lines | Functions | Branches |
|----------|-------|-----------|----------|
| `services/*.ts` | ≥80% | ≥80% | ≥80% |
| `utils/*.ts` | 100% | 100% | 100% |
| UI classes | Critical paths, no threshold |

### 11.3. Tools

- Frontend: **Vitest** (`vi.fn()`, `vi.mock()`, jsdom environment)
- Backend: **`cargo test`** with `#[cfg(test)]` modules
- Test file beside source: `ServiceName.test.ts`

---

## 12. Git & Workflow

### 12.1. Commits (Conventional, via Commitlint)

```
type(scope): description

feat(chat): add voice input support
fix(downloader): prevent race condition in concurrent downloads
refactor(settings): migrate to TauriProvider DI
```

Types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `chore`

### 12.2. Branches

```
feature/short-description
fix/issue-description
refactor/component-name
```

### 12.3. Pre-commit (Husky)

All hooks in `.github/.husky/`:

| Hook | Action |
|------|--------|
| `pre-commit` | `npm run build` (tsc + vite) |
| `commit-msg` | Commitlint validation |

### 12.4. NPM Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | **Start Dev**: Auto-formats code -> checks env -> starts app (`dev.ps1`) |
| `npm run verify-all` | **Release Gate**: Full audit (format, lint, types, tests, rust check) |
| `npm run build` | `tsc && vite build` — type-check + production bundle |
| `npm run tauri:dev` | Native Tauri dev (frontend + Rust backend) without auto-format argument |
| `npm run tauri:build` | Production Tauri build |
| `npm run release` | **Release Flow**: `verify-all` -> build -> open folder (`release.ps1`) |
| `npm run check-size` | Reports `dist/` folder size |
| `npm run clean` | Deep clean of `target/`, `dist/`, and caches (`clear.ps1`) |
| `npm run lint` | ESLint all files |
| `npm run format` | Prettier auto-fix |

> See [AUTOMATION.md](AUTOMATION.md) for detailed script documentation.

---

## 13. Security

### 13.1. Frontend

- `DOMPurify.sanitize()` for all dynamic HTML
- API keys via Tauri `secure_storage` — never `localStorage`
- No `eval()`, `Function()`, inline scripts (CSP blocks them)
- `TemplateLoader` auto-sanitizes with explicit allow-lists

### 13.2. Backend

- `unsafe_code` denied at crate level
- All crypto: audited crates (`aes-gcm`, `sha2`, `rand`)
- Hardware-bound encryption: `AES-256-GCM` + `SHA256(machine_uid + salt)`
- Never log secrets
- Validate all external outputs (MCP, AI providers)

---

## 14. Code Quality

### 14.1. Comments

Code says "what". Comments say "why".

```typescript
// ❌ Bad: restates code
// Sets theme to dark
this.settings.theme = 'dark';

// ✅ Good: explains reason
// Default to dark — prevents white flash on Windows cold start
this.settings.theme = 'dark';
```

### 14.2. Dead Code

- No commented-out blocks (Git is the backup)
- No unused imports, variables, interfaces
- No methods never called

### 14.3. AI-Generated Code

AI tools allowed for acceleration. All AI output must:
- Be reviewed and refactored before merge
- Have watermarks removed (`Generated by`, `As an AI`)
- Be verified (AI hallucinates API signatures)

### 14.4. Boy Scout Rule

Leave files cleaner than found — but ≤15 lines cleanup per PR. Large refactors → separate PR.

### 14.5. Monorepo Structure

```
/                    ← Root package.json (proxy scripts, husky, commitlint)
└── src/             ← Frontend package.json (vite, vitest, eslint, TS, deps)
    └── src-tauri/   ← Rust crate (Cargo.toml, Cargo.lock)
```

Root proxies all commands: `npm run build` → `cd src && npm run build`.

---

## 15. Scripting & Automation

We use a **Robust PowerShell Pattern** for all DevOps scripts (`.github/scripts/`).
Full documentation: [AUTOMATION.md](AUTOMATION.md).

### 15.1. Core Rules

1.  **Cross-Platform**: Must run on Windows (PowerShell 5.1/7) and Linux/macOS (PowerShell Core).
    *   Use `/` for paths where possible.
    *   Dynamic executable resolution (`npm` vs `npm.cmd`).
2.  **Safety First**:
    *   `Set-StrictMode -Version Latest`
    *   `$ErrorActionPreference = 'Stop'`
    *   `Initialize-Environment` check at start.
3.  **No Silent Failures**: Every external command must be checked.
4.  **UTF-8 Everywhere**: Force `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.

### 15.2. Verified Pipeline

Before any commit, run:
```powershell
npm run verify-all
```

This enforces:
- Frontend: Prettier, ESLint, TSC, Bundle Size
- Backend: Rustfmt, Clippy, Cargo Test
