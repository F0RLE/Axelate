# CODING STANDARDS & REQUIREMENTS (AXELATE ENGINEERING STANDARDS)

**Document Version:** 2.6.0  
**Last Updated:** 2026-01-30  
**Status:** MANDATORY  
**Total Lines:** ~4250 | **Sections:** 61

> [!IMPORTANT]
> **⚠️ LARGE DOCUMENT WARNING**
> 
> This file contains **4000+ lines** and **60 sections**. If you are an AI assistant reading this document, **DO NOT STOP at 800 lines**. You must continue reading ALL sections to understand the complete engineering standards. Use the Quick Navigation below to jump to specific sections.

This document establishes strict engineering standards for the Axelate project. Any code violating these principles will not be accepted for merge and requires immediate revision. We adhere to the **"Zero Broken Windows"** and **"Clean Code"** philosophy.

---

## 📑 Quick Navigation

<details>
<summary><b>🏗️ Foundation (1-3)</b></summary>

- [1. De-AI Policy](#1-sanitization-and-de-ai-policy-zero-tolerance)
- [2. Architecture Principles](#2-architecture-and-design-principles)
- [3. Project Structure](#3-modular-project-structure)

</details>

<details>
<summary><b>💻 Code (4-5)</b></summary>

- [4. TypeScript / Frontend](#4-frontend-typescript--high-performance)
- [5. Rust / Backend](#5-backend-rust--safety--concurrency)

</details>

<details>
<summary><b>🎨 Styling (6, 29-30)</b></summary>

- [6. CSS Architecture](#6-css-architecture)
- [29. Responsive Design](#29-responsive-design)
- [30. Animation Guidelines](#30-animation-guidelines)

</details>

<details>
<summary><b>📝 Quality (7-10)</b></summary>

- [7. Code Style & Docs](#7-code-style-and-documentation)
- [8. Testing](#8-testing-standards)
- [9. Tooling](#9-tooling--configuration)
- [10. Git Workflow](#10-git--workflow)

</details>

<details>
<summary><b>⚙️ Tauri & IPC (11, 31, 43)</b></summary>

- [11. Tauri Integration](#11-tauri-integration)
- [31. IPC Patterns](#31-tauri-ipc-patterns)
- [43. Window Lifecycle](#43-window-lifecycle--system-tray)

</details>

<details>
<summary><b>🌍 i18n & Errors (12-13, 46)</b></summary>

- [12. i18n](#12-internationalization-i18n)
- [13. Error Handling](#13-error-handling-patterns)
- [46. Error Boundaries](#46-global-error-boundaries)

</details>

<details>
<summary><b>⚡ Performance (14, 28, 32, 50)</b></summary>

- [14. Performance](#14-performance-guidelines)
- [28. Bundle Size](#28-bundle-size--performance-budget)
- [32. Caching](#32-caching-strategies)
- [50. Visibility Optimization](#50-visibility-based-resource-optimization)

</details>

<details>
<summary><b>🔒 Security (15, 44, 61)</b></summary>

- [15. Security Checklist](#15-security-checklist)
- [44. Secure Storage](#44-secure-storage-pattern)
- [61. Security Deep Dive](#61-security-deep-dive-critical)

</details>

<details>
<summary><b>🏛️ Patterns (16-22, 37-42, 45, 47-49)</b></summary>

- [16. Service Architecture](#16-service-architecture-patterns)
- [17. Logging](#17-logging-standards)
- [18. State Management](#18-state-management-patterns)
- [37. Core Orchestrator](#37-core-orchestrator-pattern)
- [38. GlobalBridge](#38-globalbridge-facade-pattern)
- [39. HTML Templates](#39-html-template-system)
- [40. Hybrid State](#40-hybrid-state-persistence)
- [41. Module Controller](#41-module-controller-pattern-mvc)
- [42. AI Streaming](#42-ai-streaming-architecture)
- [45. Observer/Pub-Sub](#45-observer-pattern-pubsub-services)
- [47. DOM Selectors](#47-dom-selector-constants)
- [48. Markdown Pipeline](#48-markdown-rendering-pipeline)
- [49. Toast Queue](#49-toast-queue-system)

</details>

<details>
<summary><b>📚 Guidelines (19-27, 33-36)</b></summary>

- [19. File Organization](#19-file--folder-organization)
- [20. API Design](#20-api-design-guidelines)
- [21. Type Definitions](#21-type-definition-patterns)
- [22. Dependencies](#22-dependency-management)
- [23. Accessibility](#23-accessibility-a11y)
- [24. Code Review](#24-code-review-checklist)
- [25. Deprecation](#25-deprecation-policy)
- [26. Environment Config](#26-environment-configuration)
- [27. Documentation](#27-documentation-requirements)
- [33. Feature Flags](#33-feature-flags)
- [34. Telemetry](#34-error-monitoring--telemetry)
- [35. Anti-Patterns](#35-anti-patterns-what-not-to-do)
- [36. Clean Code Zen](#36-clean-code--minimalism-the-zen-of-axelate)

</details>

<details>
<summary><b>🔧 Advanced Patterns (51-60)</b></summary>

- [51. System Monitor Loop](#51-backend-system-monitor-loop-rust)
- [52. Module Controller (Rust)](#52-module-controller-pattern-rust)
- [53. TauriProvider Abstraction](#53-tauriprovider-abstraction-layer)
- [54. Mock Development Mode](#54-mock-development-mode)
- [55. Navigation History](#55-navigation-history-stack)
- [56. Catalog Hydration](#56-catalog-schema-hydration)
- [57. I18n Params](#57-parameterized-translation-i18n)
- [58. Console Interceptors](#58-console-interceptors)
- [59. Log Filtering](#59-incremental-log-fetch--filtering)
- [60. Service Delegation](#60-service-to-bridge-delegation)

</details>

---

## 1. Sanitization and "De-AI" Policy (ZERO TOLERANCE)

**Our code must look like the result of highly skilled engineers, not LLMs.**

> [!IMPORTANT]
> AI tools (Gemini, ChatGPT, Claude) are **allowed for acceleration**, but:
> 1. All AI-generated code MUST be reviewed and refactored
> 2. Remove all AI "watermarks" and redundant comments
> 3. Verify logic correctness — AI hallucinates (especially with APIs/libs)
> 4. Final code must be indistinguishable from human-written

### 1.1. Prohibition of Generation Artifacts
- Strictly prohibited comments like: `Generated by`, `AI suggestion`, `As an AI I think`, `Copilot fix`, `Here is the code`.
- LLM "watermarks" in styling are prohibited (e.g., redundant comments of obvious things: `// Returns void`).
- AI-generated variable names like `temp`, `data`, `result` must be replaced with meaningful names.

### 1.2. Professional Terminology
- "Conversational" style in comments and documentation is prohibited.
- ❌ *Bad:* `"This thing tries to grab data"`
- ✅ *Good:* `"Attempts to retrieve payload with exponential backoff strategy"`
- ❌ *Bad:* `"Fixing the bug with user login"`
- ✅ *Good:* `"Patched race condition in authentication flow during session rehydration"`

### 1.3. AI Hallucination Mitigation
- **Always verify**: API signatures, library versions, function names
- **Never trust**: Complex regex, crypto code, edge cases from AI
- **Test everything**: AI code must have 100% test coverage for critical paths

### 1.4. Principle of "Meaningfulness"
- If code looks like boilerplate, it should be abstracted.
- If a comment doesn't explain *why* an architectural decision was made (business context or platform constraint), it should be deleted.

---

## 2. Architecture and Design Principles

### 2.1. SOLID & GRASP
- **SRP (Single Responsibility):** A module is responsible for one actor. If a class manages both rendering and networking — that's a violation.
- **OCP (Open/Closed):** Classes are open for extension, closed for modification. Use inheritance and composition.
- **LSP (Liskov Substitution):** Subtypes must be interchangeable with base types.
- **ISP (Interface Segregation):** Many small interfaces are better than one large one.
- **DIP (Dependency Inversion):** High-level modules should not depend on low-level ones. Both should depend on abstractions (Interfaces/Traits).

### 2.2. State Management
- **Single Source of Truth.** Avoid duplicating state across different parts of the system.
- **Unidirectional Data Flow.** Data flows in one direction. State changes only through defined points.
- **Use `UIStateInterface`** for global UI state.

### 2.3. Side Effects Isolation
- Pure Functions should be the priority.
- All I/O operations must be explicitly isolated in service layers (`services/`).
- Document side effects in JSDoc with `@sideeffect` tag.

### 2.4. Event-Driven Architecture
- Use `EventBus` for inter-module communication.
- Event naming: `domain:action` (e.g.: `page:change`, `module:download:complete`).
- Always unsubscribe from events in cleanup/destroy methods.

---

## 3. Modular Project Structure

### 3.1. Directory Structure
```
src/
├── app/               # Core application logic
│   ├── init.ts        # Entry point
│   ├── router.ts      # Navigation router
│   └── events.ts      # Global event handlers
├── features/          # Feature modules (Business Logic & UI)
│   ├── ai/            # AI features
│   ├── chat/          # Chat interface
│   ├── dashboard/     # Main dashboard
│   ├── debug/         # Debug tools
│   ├── downloads/     # Download manager
│   ├── monitoring/    # System monitoring
│   └── settings/      # Settings pages
├── shared/            # Shared code
│   ├── components/    # Reusable UI components
│   ├── services/      # Core services (Logger, EventBus)
│   ├── types/         # Shared types
│   └── utils/         # Utility functions
├── infrastructure/    # Technical infrastructure
│   ├── http/          # HTTP client
│   ├── i18n/          # Internationalization
│   ├── navigation/    # Navigation service
│   └── tauri/         # Tauri bridge
├── styles/            # Global styles
│   ├── base/          # Base styles
│   ├── components/    # Component styles
│   ├── features/      # Feature-specific styles
│   └── main.css       # Main entry point
├── assets/            # Static assets
└── test/              # Setup and global tests
```

### 3.2. Module Rules
- Each module is autonomous and contains its own types, UI, services.
- Modules interact through `EventBus` or exported APIs.
- Circular dependencies between modules are prohibited.
- Module's public API is exported through `index.ts`.

### 3.3. Lightweight Module Pattern
- **Definition:** Modules must be loosely coupled and decentralized.
- **Independence:** A module should NOT strictly depend on another module's internal implementation. Use `Core` services or `EventBus` for dependencies.
- **Lazy Loading:** Modules should support lazy initialization to keep startup time minimal.
- **No Framework Lock-in:** Avoid binding business logic to specific UI frameworks (React/Vue). Keep logic in `services/` (Vanilla TS).

---

## 4. Frontend (TypeScript / High Performance)

### 4.1. Type Safety (STRICT MODE)

**TypeScript Configuration:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noFallthroughCasesInSwitch": true,
    "target": "ESNext",
    "module": "ESNext"
  }
}
```

**Rules:**
- ❌ **NO `any`:** Using `any` is prohibited. Use `unknown` with Type Guard.
- ✅ **Strict Null Checks:** All fields that can be `null`/`undefined` must be handled explicitly (`?.`, `??`).
- ✅ **Interfaces over Types:** Use `interface` for public contracts.
- ✅ **Explicit Return Types:** Public methods must have explicit return type.

```typescript
// ❌ Bad
function processData(data: any) {
    return data.value;
}

// ✅ Good
function processData(data: unknown): string | null {
    if (isValidData(data)) {
        return data.value;
    }
    return null;
}

function isValidData(data: unknown): data is { value: string } {
    return typeof data === 'object' && data !== null && 'value' in data;
}
```

### 4.2. Interfaces & Types

**Naming Conventions:**
- Interfaces: `I` prefix for important contracts (`IApp`, `IModule`, `IConfigField`)
- Type aliases: no prefix, PascalCase (`LogEntry`, `ModuleDownloadState`)
- Generics: single uppercase letter (`T`, `K`, `V`) or descriptive name (`TPayload`)

```typescript
// ✅ Well-defined interface
export interface IApp {
    id: string;
    name?: string;
    nameKey?: string;
    desc?: string;
    descKey?: string;
    icon?: string;
    type?: 'api' | 'local';
    installed?: boolean;
    repoUrl?: string;
    config_schema?: Record<string, IConfigField>;
}
```

### 4.3. Performance & Lifecycle

**DOM Manipulation:**
- Minimize direct DOM access (`document.getElementById`). Cache references.
- Use `requestAnimationFrame` for animations.
- ❌ Never use `setInterval` for visual effects.

**Memory Management:**
- **MANDATORY:** All subscriptions (`addEventListener`, `Observer`, `WebSocket`, `EventBus.on`) must be removed in cleanup methods.
- Memory leak is a **blocking P0 bug**.
- Use `debounce`/`throttle` for `onInput`, `onResize`, `onScroll` handlers.

```typescript
// ✅ Proper cleanup
class ModuleUI {
    private unsubscribers: (() => void)[] = [];

    public init(): void {
        const unsub = eventBus.on('page:change', this.handlePageChange);
        this.unsubscribers.push(unsub);
        
        window.addEventListener('resize', this.handleResize);
        this.unsubscribers.push(() => window.removeEventListener('resize', this.handleResize));
    }

    public destroy(): void {
        this.unsubscribers.forEach(fn => fn());
        this.unsubscribers = [];
    }
}
```

### 4.4. Security

- **XSS Prevention:** `innerHTML` for user content is prohibited. Use `DOMPurify.sanitize()` or `textContent`.
- **No Sensitive Data:** No API keys, secrets on client. Use `axelateAPI.secureStorage`.
- **CSP Compliance:** No inline scripts. All scripts through modules.

```typescript
// ✅ Safe content insertion
import DOMPurify from 'dompurify';

const sanitizedHtml = DOMPurify.sanitize(userInput);
element.innerHTML = sanitizedHtml;

// Or even better:
element.textContent = userInput;
```

### 4.5. Async/Await Best Practices

```typescript
// ❌ Bad: Unhandled promise
async function loadData() {
    const data = await fetchData();
    return data;
}
loadData(); // Promise ignored!

// ✅ Good: Proper error handling
async function loadData(): Promise<Data | null> {
    try {
        const data = await fetchData();
        return data;
    } catch (error) {
        console.error('[Module] Failed to load data:', error);
        globalThis.showToast?.('Failed to load data', 'error');
        return null;
    }
}

// ✅ Good: Top-level await or .catch()
loadData().catch(console.error);
```

### 4.6. Type Synchronization Policy
- **Backend-First Truth:** The Rust Backend Struct is the Source of Truth.
- **Manual Sync (for now):** When changing a Rust struct (e.g., `AppSettings`), immediately update the corresponding TypeScript interface (`IAppSettings`).
- **No "Any" Bridges:** Do not type invoke results as `any`. Always create a matching interface.
- **Validation:** Frontend should validate received data structure if trust is low (e.g., external plugins).

> [!TIP]
> **Future Automation:** Consider [tauri-specta](https://github.com/oscartbeaumont/tauri-specta) or [ts-rs](https://github.com/Aleph-Alpha/ts-rs) for automatic generation of TS types from Rust structs. This eliminates human error in manual sync.

---

## 5. Backend (Rust / Safety & Concurrency)

### 5.1. Error Handling (Panic-free zone)

- **Result Propagation:** Functions return `Result<T, E>`, not panic.
- **Structured Errors:** Use `thiserror` for libraries, `anyhow` for applications.

**Unwrap Policy:**
- `unwrap()` / `expect()` allowed ONLY:
  1. In tests (`#[cfg(test)]`)
  2. In `const` initialization or `lazy_static`/`once_cell`
  3. When invariant is mathematically proven (with `// SAFETY: ...` comment)
- In all other cases — `match` or `?`.

### 5.2. Concurrency & Async

- **Non-blocking:** Never block Tokio thread (`std::thread::sleep`).
- Use `tokio::time::sleep` or `tokio::task::spawn_blocking` for heavy computations.
- **State Sharing:** Minimize `Mutex`. Consider Actor Pattern via `mpsc` channels.

### 5.3. Code Style (Idiomatic Rust)

- Use Clippy as law: `cargo clippy -- -D warnings`
- **Newtype Pattern:** Wrapper types instead of primitives (`struct UserId(String)`).
- Documentation via `///` for public APIs.

### 5.4. Error Handling Standard (Strict)
- **Use `AppError`:** All internal Service methods MUST return `Result<T, AppError>`.
- **No Strings:** Returning `Result<T, String>` is PROHIBITED in Services. String errors make handling impossible.
- **Mapping:** Explicitly map external errors to `AppError` variants:
  ```rust
  // ❌ Bad
  File::open(path).map_err(|e| e.to_string())?
  
  // ✅ Good
  File::open(path).map_err(|e| AppError::Io(e))?
  ```

---

## 6. CSS Architecture

### 6.1. Style Organization

```
css/
├── base/              # Foundation
│   ├── variables.css  # CSS Custom Properties
│   ├── reset.css      # CSS Reset/Normalize  
│   ├── scrollbar.css  # Custom scrollbars
│   └── animations.css # Keyframes
├── components/        # Reusable components
│   ├── buttons.css
│   ├── cards.css
│   ├── forms.css
│   └── status.css
├── layout/            # Structural elements
│   ├── sidebar.css
│   ├── modals.css
│   └── toasts.css
├── modules/           # Module styles
│   ├── dashboard.css
│   ├── chat.css
│   └── settings.css
└── main.css           # Entry point with @import
```

### 6.2. CSS Variables (Design Tokens)

**MANDATORY** to use CSS Custom Properties for:
- Colors: `--primary`, `--surface`, `--text-primary`, `--text-secondary`, `--text-muted`
- Spacing: `--spacing-xs`, `--spacing-sm`, `--spacing-md`, `--spacing-lg`
- Border radius: `--radius-sm`, `--radius-md`, `--radius-lg`
- Transitions: `--transition-fast`, `--transition-normal`

```css
/* ❌ Bad */
.button {
    background: #8a2be2;
    padding: 8px 16px;
}

/* ✅ Good */
.button {
    background: var(--primary);
    padding: var(--spacing-sm) var(--spacing-md);
}
```

### 6.3. Utility Classes

Project uses utility-first approach for common patterns:

```css
/* Flex */
.flex, .flex-col, .flex-center, .flex-between
.items-center, .justify-center, .flex-1

/* Spacing */
.gap-xs, .gap-sm, .gap-md, .gap-lg, .gap-xl
.p-md, .p-lg, .p-xl
.mt-auto, .mb-auto, .mx-auto

/* Text */
.text-center, .text-primary, .text-secondary, .text-muted
.font-bold, .font-semibold, .font-medium

/* Visibility */
.hidden, .visible, .fade-out
```

### 6.4. Naming Convention (BEM-inspired)

```css
/* Block */
.toast-container { }

/* Element */
.toast-content { }
.toast-title { }
.toast-message { }

/* Modifier */
.toast.leaving { }
.toast.success { }
.toast.error { }
```

### 6.5. Animations

- Define all animations in `animations.css`
- Use `transform` and `opacity` for performance
- Duration: 150-300ms for UI, 300-500ms for page transitions
- Prefer `ease-out` for entry, `ease-in` for exit

---

## 7. Code Style and Documentation

### 7.1. Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `AppUI`, `EventBus` |
| Interfaces | I + PascalCase | `IApp`, `IModule` |
| Functions/Methods | camelCase | `showToast`, `handleClick` |
| Constants | SCREAMING_SNAKE | `GPT_MODELS`, `MAX_RETRIES` |
| Private methods | _prefix | `_ensureToastContainer` |
| Event handlers | handle/on prefix | `handleClick`, `onPageChange` |
| Boolean | is/has/should prefix | `isValid`, `hasAccess`, `shouldRender` |
| Files | PascalCase for classes | `AppUI.ts`, `EventBus.ts` |
| CSS classes | kebab-case | `toast-container`, `model-card` |

**Prohibited:**
- Single-letter variables (except `i`, `j` in loops; `x`, `y` in coordinates; `e` for events)
- Abbreviations without context (`usr`, `mgr`, `cfg` — bad; `userId`, `configManager` — good)

### 7.2. Comments & Documentation

**Principle:** Code says "What". Comments say "Why".

**JSDoc for public methods:**
```typescript
/**
 * Displays a toast notification to the user.
 * 
 * @param message - The message to display
 * @param type - Toast type: 'success' | 'error' | 'warning' | 'info'
 * @param duration - Display duration in ms (default: 3000)
 * @param title - Optional title for the toast
 * @param id - Optional unique ID for updating existing toasts
 * 
 * @example
 * showToast('Settings saved', 'success');
 * showToast('Connection lost', 'error', 5000, 'Network Error');
 */
public showToast(
    message: string,
    type: string = 'info',
    duration: number = 3000,
    title: string | null = null,
    id: string | null = null
): void
```

**TODO format:**
```typescript
// TODO(@username): Description of what needs to be done [#issue-id]
// TODO(@forle): Implement retry logic for failed downloads [#123]
```

**Console logging:**
```typescript
// Use prefixes for tracing
console.debug('[AppUI] Download module requested:', app.id);
console.error('[ModuleName] Operation failed:', error);
```

---

## 8. Testing Standards

### 8.1. Test Framework

- **Vitest** — primary testing framework
- Configuration in `vite.config.ts`

### 8.2. Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ComponentName', () => {
    beforeEach(() => {
        // Setup/cleanup
    });

    describe('methodName', () => {
        it('should do X when Y', () => {
            // Arrange
            const input = createTestInput();
            
            // Act
            const result = component.method(input);
            
            // Assert
            expect(result).toBe(expected);
        });

        it('should handle edge case Z', () => {
            // ...
        });
    });
});
```

### 8.3. Naming Convention for Tests

- Files: `ComponentName.test.ts`
- Describe: component/module name
- It: `should [expected behavior] when [condition]`

### 8.4. Mocking

```typescript
// Use vi.fn() for mocks
const handler = vi.fn();
eventBus.on('page:change', handler);

eventBus.emit('page:change', { pageId: 'home' });

expect(handler).toHaveBeenCalledTimes(1);
expect(handler).toHaveBeenCalledWith({ pageId: 'home' });
```

### 8.5. Coverage Requirements

- Services (`services/`): minimum 80% coverage
- Utility functions: 100% coverage
- UI components: test critical logic

---

## 9. Tooling & Configuration

### 9.1. ESLint

**Configuration:** `eslint.config.js`

**Key rules:**
```javascript
{
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
    }],
    '@typescript-eslint/only-throw-error': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'curly': ['error', 'multi-line'],
}
```

**Unused variables:** Use `_` prefix for intentionally unused parameters:
```typescript
function callback(_event: Event, data: Data): void {
    process(data);
}
```

### 9.2. Prettier

**Configuration:** `.prettierrc`

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

### 9.3. Pre-commit Checks

Before each commit:
```bash
npm run lint        # ESLint check
npm run format      # Prettier check
npm run typecheck   # TypeScript check
npm run test        # Unit tests
```

---

## 10. Git & Workflow

### 10.1. Branch Naming

```
feature/short-description
fix/issue-description
refactor/component-name
hotfix/critical-bug
```

### 10.2. Commit Messages (Conventional Commits)

**Format:** `type(scope): description`

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change without functionality change |
| `perf` | Performance improvement |
| `style` | Formatting, spaces, semicolons |
| `test` | Adding/changing tests |
| `docs` | Documentation changes |
| `chore` | Build, dependencies update |
| `ci` | CI/CD changes |

**Examples:**
```
feat(chat): add voice input support
fix(downloader): prevent race condition in concurrent downloads
refactor(ui): extract toast logic into dedicated class
perf(eventbus): optimize listener lookup with Map
docs(readme): update installation instructions
```

### 10.3. Atomic Commits

- One commit — one logical change
- Commit should leave project in working state
- Split large changes into series of atomic commits

### 10.4. Pull Request Requirements

- Description: what, why, how tested
- Linked issues (if any)
- Screenshots for UI changes
- All checks must pass (lint, tests, typecheck)

---

## 11. Tauri Integration

### 11.1. Command Invocation

```typescript
// Always use typed invoke
interface ModuleStatus {
    status: 'running' | 'stopped' | 'error';
    pid?: number;
}

const status = await globalThis.__TAURI__.core.invoke<ModuleStatus>(
    'get_module_status',
    { moduleId: app.id }
);
```

### 11.2. Event Listening

```typescript
// Subscription with cleanup
const unlisten = await globalThis.__TAURI__.event.listen<DownloadProgress>(
    'download:progress',
    (event) => {
        updateProgress(event.payload);
    }
);

// In destroy/cleanup
unlisten();
```

### 11.3. Window API

```typescript
const win = globalThis.__TAURI__.window.getCurrentWindow();
const isMax = await win.isMaximized();
```

---

## 12. Internationalization (i18n)

### 12.1. Translation Keys

**Format:** `domain.component.element`

```typescript
// ✅ Good
globalThis.t('ui.launcher.module.download', 'Download');
globalThis.t('ui.common.settings', 'Settings');
globalThis.t('ui.launcher.status.running', 'Running');

// ❌ Bad
globalThis.t('download');  // Too short
globalThis.t('The module is currently running');  // Full sentence as key
```

### 12.2. Fallback Strategy

```typescript
// Always specify fallback
const text = globalThis.t?.('ui.launcher.button.stop', 'Stop') ?? 'Stop';
```

---

## 13. Error Handling Patterns

### 13.1. Try-Catch Boundaries

```typescript
// ✅ Handling at operation boundary
private async _handleDeleteModule(app: IApp, category: string): Promise<void> {
    console.debug('[AppUI] Remove module requested:', app.id);
    try {
        if (globalThis.__TAURI__?.core) {
            await globalThis.__TAURI__.core.invoke('delete_module', { moduleId: app.id });
            app.installed = false;
            // Update UI...
        }
    } catch (err) {
        console.error('Delete error:', err);
        this.showToast(
            globalThis.t?.('ui.launcher.web.delete_model_error', 'Delete error') ?? 'Delete error',
            'error'
        );
    }
}
```

### 13.2. Graceful Degradation

```typescript
// Check API availability before use
if (globalThis.aiBridge) {
    await globalThis.aiBridge.startProvider(app.id);
} else if (globalThis.showToast) {
    globalThis.showToast('AI Bridge not initialized', 'error');
}
```

---

## 14. Performance Guidelines

### 14.1. DOM Operations

- Batch DOM reads and writes separately (avoid layout thrashing)
- Use `DocumentFragment` for multiple insertions
- Cache querySelector results

### 14.2. Event Handlers

```typescript
// ✅ Debounce for input handlers
const handleSearch = debounce((term: string) => {
    performSearch(term);
}, 300);

// ✅ Throttle for scroll/resize
const handleScroll = throttle(() => {
    updateScrollPosition();
}, 16); // ~60fps
```

### 14.3. Lazy Loading

- Load modules on demand
- Import heavy libraries dynamically

```typescript
// Dynamic import
const DOMPurify = await import('dompurify');
```

---

## 15. Security Checklist

### 15.1. Input Validation
- [ ] All user data is sanitized
- [ ] DOMPurify used for HTML
- [ ] Validation on client AND server

### 15.2. Data Protection
- [ ] Sensitive data in SecureStorage
- [ ] No hardcoded credentials
- [ ] API keys not logged

### 15.3. XSS Prevention
- [ ] innerHTML only with DOMPurify
- [ ] textContent for plain text
- [ ] No eval() or Function()

---

## 16. Service Architecture Patterns

### 16.1. Singleton Services

All global services are implemented as Singletons with explicit export:

```typescript
// ✅ Correct Singleton pattern
class EventBusImpl {
    private readonly listeners: Map<string, Set<EventHandler>> = new Map();
    
    // ... methods
}

// Singleton export
export const eventBus = new EventBusImpl();
```

**Implementation Pattern:**
```typescript
export class MyFeatureService {
    private static instance: MyFeatureService;
    private constructor() {}

    public static getInstance() {
        if (!this.instance) this.instance = new MyFeatureService();
        return this.instance;
    }
}
```

**Singleton Services List:**
| Service | Export | Purpose |
|---------|--------|---------|
| `EventBus` | `eventBus` | Inter-module communication |
| `ErrorHandler` | `errorHandler` | Global error handling |
| `LoggerService` | `logger` | Centralized logging |
| `AIBridge` | `aiBridge` | AI provider abstraction |
| `ChatFileHandler` | `chatFileHandler` | Chat file management |

### 16.2. Service Initialization

```typescript
// ✅ Idempotent initialization
class ServiceImpl {
    private initialized = false;

    init(): void {
        if (this.initialized) {
            console.warn('[Service] Already initialized');
            return;
        }
        
        // initialization logic...
        
        this.initialized = true;
        console.log('[Service] Initialized');
    }
}
```

### 16.3. Global Registration

```typescript
// Registration on globalThis for access from HTML/legacy code
constructor() {
    (globalThis as unknown as Record<string, unknown>).aiBridge = this;
    console.log('[AIBridge] Initialized');
}
```

---

## 17. Logging Standards

### 17.1. Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| `DEBUG` | Detailed debug information | `[Module] Processing item 5 of 10` |
| `INFO` | Important lifecycle events | `[Module] Initialized successfully` |
| `WARN` | Potential issues | `[Module] Fallback to default config` |
| `ERROR` | Errors requiring attention | `[Module] Failed to connect: timeout` |

### 17.2. Log Format

```typescript
// ✅ Mandatory format: [ModuleName] Message
console.log('[AIBridge] Provider started: gemini');
console.debug('[AppUI] Download module requested:', app.id);
console.error('[ErrorHandler] Callback error:', e);
console.warn('[EventBus] No listeners for event:', event);
```

### 17.3. Structured Logging

```typescript
// ✅ For complex data
console.log('[Module] State update:', {
    previousState: 'idle',
    newState: 'loading',
    trigger: 'user_action'
});
```

### 17.4. Production Considerations

- `console.debug` is automatically filtered in production
- Sensitive data (API keys, tokens) **NEVER** log
- Use `LoggerService` for persistent logging

---

## 18. State Management Patterns

### 18.1. LocalStorage Keys

**Naming Convention:** `{module}_{setting}`

```typescript
// ✅ Good
localStorage.getItem('gemini_selected_model');
localStorage.getItem('local_gpu_layers');
localStorage.getItem('download_speed_limit');

// ❌ Bad
localStorage.getItem('model');
localStorage.getItem('gpuLayers');
```

### 18.2. State Interface Pattern

```typescript
// ✅ Typed state interface
interface UIStateInterface {
    load?: () => Promise<void>;
    setSelectedModule: (category: string, data: ModuleData) => void;
    removeSelectedModule: (category: string) => void;
    getSelectedModules: () => Record<string, ModuleData>;
    getSidebarWidth: () => number;
    setSidebarWidth: (width: number) => void;
}
```

### 18.3. Immutable State Updates

```typescript
// ✅ Immutable update
public getErrorLog(): ErrorInfo[] {
    return [...this.errorLog]; // Shallow copy
}

// ✅ For nested objects
const newState = {
    ...prevState,
    modules: {
        ...prevState.modules,
        [moduleId]: newModule
    }
};
```

---

## 19. File & Folder Organization

### 19.1. Module Structure Template

```
modules/{module-name}/
├── index.ts           # Public API exports
├── {module-name}.ts   # Main module logic
├── services/          # Module-specific services
├── types/             # TypeScript interfaces
│   └── {module}Types.ts
├── ui/                # UI components
│   └── {Module}UI.ts
└── utils/             # Helper functions
    └── {module}Utils.ts
```

### 19.2. File Naming

| Type | Format | Example |
|------|--------|---------|
| Classes/Components | PascalCase | `AppUI.ts`, `EventBus.ts` |
| Types | camelCase + Types suffix | `coreTypes.ts`, `aiTypes.ts` |
| Utils | camelCase + Utils suffix | `chatUtils.ts`, `catalogHelpers.ts` |
| Tests | {name}.test.ts | `EventBus.test.ts` |
| CSS modules | kebab-case | `dashboard.css`, `main-area.css` |

### 19.3. Index Exports

```typescript
// modules/ai/index.ts
export { AIBridge, aiBridge } from './AIBridge';
export type { MessageSource, MessageHandler } from './types/aiTypes';
```

---

## 20. API Design Guidelines

### 20.1. Method Signatures

```typescript
// ✅ Optional parameters last, with defaults
public showToast(
    message: string,                    // Required
    type: string = 'info',              // Optional with default
    duration: number = 3000,            // Optional with default
    title: string | null = null,        // Optional, explicitly nullable
    id: string | null = null            // Optional, explicitly nullable
): void
```

### 20.2. Return Types

```typescript
// ✅ Async methods return Promise<T>
async startProvider(providerId: string): Promise<boolean>

// ✅ Methods that can fail return T | null
getActiveProvider(): { id: string; name: string } | null

// ✅ Cleanup methods return unsubscribe function
on(event: K, handler: EventHandler): () => void
```

### 20.3. Callback Patterns

```typescript
// ✅ Callback type definition
export type AttachmentUpdateCallback = (
    files: File[],
    onRemove: (index: number) => void
) => void;

// ✅ Callback registration
public setUpdateCallback(callback: AttachmentUpdateCallback): void {
    this.onUpdate = callback;
}
```

---

## 21. Type Definition Patterns

### 21.1. Discriminated Unions

```typescript
// ✅ Use for variant types
export interface ModuleDownloadState {
    status: 'init' | 'pending' | 'connecting' | 'downloading' | 'extracting' | 'complete' | 'error';
    progress: number;
    message?: string;
    downloaded?: number;
    total?: number;
    error?: unknown;
}
```

### 21.2. Type Organization

```typescript
// ✅ Group by categories with comments
// ============================================================================
// Message Types
// ============================================================================

export type MessageSource = 'chat' | 'service' | 'system';
export type MessageHandler = (response: string, source: MessageSource) => void;

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ChatRequest { /* ... */ }
export interface ChatResponse { /* ... */ }
```

### 21.3. Global Type Augmentation

```typescript
// types/global.d.ts
declare global {
    function t(key: string, def?: string): string;
    var logger: LoggerInterface;
    var aiBridge: AIBridgeInterface;
    
    interface Window {
        t: typeof t;
        logger: typeof logger;
        // ...
    }
}

export {}; // Make this a module
```

---

## 22. Dependency Management

### 22.1. Import Order

```typescript
// 1. Node/built-in modules
import { fileURLToPath, URL } from 'node:url';

// 2. External packages
import DOMPurify from 'dompurify';
import { defineConfig } from 'vitest/config';

// 3. Internal modules (absolute paths with @/)
import { eventBus } from '@/modules/core/services/EventBus';

// 4. Relative imports
import type { ChatMessage } from './providers/AIProvider';
import { getApiModelIdWithFallback } from './utils/catalogHelpers';
```

### 22.2. Type-only Imports

```typescript
// ✅ Use type imports for types
import type { ChatMessage } from './providers/AIProvider';
import type { 
    MessageSource, 
    MessageHandler, 
    ChatRequest 
} from './types/aiTypes';
```

### 22.3. Re-exports

```typescript
// ✅ Centralized re-export for public API
export type { MessageSource, MessageHandler } from './types/aiTypes';
```

---

## 23. Accessibility (A11y)

### 23.1. Keyboard Navigation

- All interactive elements accessible via Tab
- Focus visible styles are mandatory
- Escape closes modal windows

### 23.2. ARIA Attributes

```html
<!-- ✅ Modal windows -->
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">Settings</h2>
</div>

<!-- ✅ Icon buttons -->
<button aria-label="Close settings" title="Close">
    <svg>...</svg>
</button>

<!-- ✅ Loading states -->
<button aria-busy="true" disabled>
    Loading...
</button>
```

### 23.3. Color Contrast

- Minimum 4.5:1 for normal text
- Minimum 3:1 for large text (18px+)
- Don't rely only on color to convey information

---

## 24. Code Review Checklist

### 24.1. Before Submitting PR

- [ ] Code conforms to ESLint/Prettier configuration
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] All tests pass (`npm run test`)
- [ ] No console.log (except debug logs with prefix)
- [ ] No commented-out code
- [ ] No TODO without author and issue

### 24.2. Reviewer Checklist

- [ ] Code is understandable without additional explanations
- [ ] No logic duplication
- [ ] Error handling present
- [ ] No memory leaks (subscriptions cleaned)
- [ ] No security vulnerabilities (XSS, hardcoded secrets)
- [ ] Performance is adequate
- [ ] Types are correct (no any without justification)

---

## 25. Deprecation Policy

### 25.1. Deprecation Process

1. Mark function with `@deprecated` indicating replacement and removal version
2. Add console.warn on first use
3. Update documentation
4. Remove after 2 minor versions

### 25.2. Deprecation Annotation

```typescript
/**
 * @deprecated Since v2.0.0. Use `eventBus.emit()` instead. Will be removed in v3.0.0.
 */
public triggerEvent(name: string, data: unknown): void {
    console.warn('[DEPRECATED] triggerEvent() is deprecated. Use eventBus.emit() instead.');
    eventBus.emit(name as keyof EventBusEvents, data);
}
```

---

## 26. Environment Configuration

### 26.1. Vite Environment Variables

```typescript
// ✅ Use VITE_ or TAURI_ prefix
envPrefix: ['VITE_', 'TAURI_'],

// Access in code
const apiUrl = import.meta.env.VITE_API_URL;
const isDebug = import.meta.env.TAURI_DEBUG;
```

### 26.2. Build Targets

```typescript
build: {
    // Tauri v2: Chrome 120+ on Windows, Safari 15+ on macOS/Linux
    target: process.env.TAURI_PLATFORM === 'windows' 
        ? 'chrome120' 
        : 'safari15',
    minify: process.env.TAURI_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG,
}
```

---

## 27. Documentation Requirements

### 27.1. Module Documentation Header

```typescript
/**
 * @module ai/AIBridge
 * @description Central hub for AI communication - uses Tauri backend for API calls
 * 
 * @example
 * ```typescript
 * import { aiBridge } from './AIBridge';
 * 
 * await aiBridge.startProvider('gemini');
 * const response = await aiBridge.sendMessage('Hello!');
 * ```
 */
```

### 27.2. Complex Logic Documentation

```typescript
/**
 * Map UI model names to actual API model IDs.
 * Uses centralized catalog helpers with legacy fallback.
 * 
 * This is necessary because UI displays user-friendly names
 * while APIs expect specific model identifiers.
 * 
 * @param providerId - Provider ID (e.g., 'gpt', 'gemini')
 * @param uiModel - UI display name of the model
 * @returns API model identifier
 */
private mapModelToApiId(providerId: string, uiModel: string): string {
    return getApiModelIdWithFallback(providerId, uiModel);
}
```

---

## 28. Bundle Size & Performance Budget

> [!NOTE]
> These limits are aggressive but achievable for a Tauri app with pure Vanilla TS.
> Since we don't use React/Vue/Angular, our baseline is near-zero.
> Requires: Tree Shaking, lazy loading, dynamic imports for all modules.

### 28.1. Size Limits

| Metric | Limit | Action on Exceed |
|--------|-------|------------------|
| Initial JS bundle | < 500KB gzipped | Blocks merge |
| CSS bundle | < 100KB gzipped | Warning |
| Largest chunk | < 200KB gzipped | Requires lazy loading |
| Total assets | < 2MB | Review required |

### 28.2. Tree Shaking

```typescript
// ✅ Named exports for tree shaking
export { eventBus } from './EventBus';
export { showToast } from './toasts';

// ❌ Avoid default exports for library code
export default class HugeLibrary { }  // Bad
```

### 28.3. Code Splitting

```typescript
// ✅ Lazy load heavy modules
const DebugModule = lazy(() => import('./modules/debug'));

// ✅ Dynamic import for rarely used code
async function showAdvancedSettings() {
    const { AdvancedSettings } = await import('./AdvancedSettings');
    return new AdvancedSettings();
}
```

### 28.4. Bundle Analysis

```bash
# Bundle analysis before release
npm run build -- --analyze

# Size check in CI
npx bundlesize
```

---

## 29. Responsive Design

### 29.1. Breakpoints

```css
/* Mobile First approach */
:root {
    --breakpoint-sm: 640px;   /* Mobile landscape */
    --breakpoint-md: 768px;   /* Tablet */
    --breakpoint-lg: 1024px;  /* Desktop */
    --breakpoint-xl: 1280px;  /* Large desktop */
    --breakpoint-2xl: 1536px; /* Ultra-wide */
}

/* ✅ Mobile-first media queries */
.sidebar {
    width: 100%;  /* Mobile default */
}

@media (min-width: 768px) {
    .sidebar {
        width: 280px;  /* Tablet+ */
    }
}
```

### 29.2. Fluid Typography

```css
/* ✅ Clamp for adaptive sizes */
.title {
    font-size: clamp(1.5rem, 4vw, 2.5rem);
}

.container {
    padding: clamp(1rem, 3vw, 2rem);
}
```

### 29.3. Touch Targets

- Minimum touch target size: **44x44px**
- Spacing between interactive elements: minimum **8px**

```css
/* ✅ Adequate touch targets */
.btn {
    min-height: 44px;
    min-width: 44px;
    padding: 12px 24px;
}
```

### 29.4. Container Queries (Future)

```css
/* When support reaches 90%+ */
@container sidebar (min-width: 300px) {
    .nav-item {
        flex-direction: row;
    }
}
```

---

## 30. Animation Guidelines

### 30.1. Timing Standards

| Animation Type | Duration | Easing |
|----------------|----------|--------|
| Micro-interactions | 100-200ms | `ease-out` |
| UI transitions | 200-300ms | `ease-in-out` |
| Page transitions | 300-500ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Loading spinners | 1000-2000ms | `linear` |
| Attention seekers | 400-600ms | `ease-in-out` |

### 30.2. Animation Properties

```css
/* ✅ GPU-accelerated properties ONLY */
.animate-good {
    transform: translateX(100px);
    opacity: 0.5;
}

/* ❌ Avoid - triggers layout/paint */
.animate-bad {
    left: 100px;      /* Bad */
    width: 200px;     /* Bad */
    margin-left: 10px; /* Bad */
}
```

### 30.3. Reduced Motion

```css
/* ✅ MANDATORY: Respect user preferences */
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```

### 30.4. Animation Patterns

```css
/* ✅ Toast enter animation */
@keyframes toast-enter {
    from {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.toast {
    animation: toast-enter 300ms ease-out;
}

.toast.leaving {
    animation: toast-enter 200ms ease-in reverse;
}
```

---

## 31. Tauri IPC Patterns

### 31.1. Command Naming

```rust
// Backend (Rust)
#[tauri::command]
async fn get_module_status(module_id: String) -> Result<ModuleStatus, String>

#[tauri::command]
async fn delete_module(module_id: String) -> Result<(), String>
```

### 31.1.5. Type Synchronization Policy (CRITICAL)

> [!CAUTION]
> **Priority #1 Tech Debt:** Manual type sync is the biggest human error risk in this project. Implementing `tauri-specta` or `ts-rs` should be the first automation task.

Since Tauri v2 does not yet fully enforce type safety across the bridge automatically in this project:

1.  **Single Source of Truth:** The **Rust Struct** is the source of truth.
2.  **Manual Sync:** Any change to a Rust struct marked with `#[derive(Serialize, Deserialize)]` MUST be immediately reflected in the corresponding TypeScript interface.
3.  **Validation:** PRs affecting IPC must include a screenshot or statement verifying that frontend types match backend structs.
4.  **Future:** We aim to integrate `tauri-specta` or `ts-rs` to automate this. Until then, vigilance is mandatory.

**Naming Convention:** `verb_noun` (snake_case)
- `get_*` — read operations
- `set_*` — write operations
- `delete_*` — deletion
- `send_*` — data sending
- `start_*` / `stop_*` — process management

### 31.2. Frontend Invocation

```typescript
// ✅ Typed invoke with error handling
interface ModuleStatus {
    status: 'running' | 'stopped' | 'error';
    pid?: number;
    error?: string;
}

async function getModuleStatus(moduleId: string): Promise<ModuleStatus | null> {
    try {
        if (!globalThis.__TAURI__?.core) {
            console.warn('[Tauri] Not available, using fallback');
            return null;
        }
        
        return await globalThis.__TAURI__.core.invoke<ModuleStatus>(
            'get_module_status',
            { moduleId }  // camelCase → snake_case automatically
        );
    } catch (error) {
        console.error('[Tauri] Command failed:', error);
        return null;
    }
}
```

### 31.3. Event Subscriptions

```typescript
// ✅ Tauri events with cleanup
class ModuleManager {
    private unlisteners: (() => void)[] = [];

    async init(): Promise<void> {
        const unlisten = await globalThis.__TAURI__.event.listen<DownloadProgress>(
            'module:download:progress',
            (event) => this.handleProgress(event.payload)
        );
        this.unlisteners.push(unlisten);
    }

    destroy(): void {
        this.unlisteners.forEach(fn => fn());
        this.unlisteners = [];
    }
}
```

### 31.4. Error Handling

```typescript
// ✅ Structured errors from Tauri
interface TauriError {
    code: string;
    message: string;
    details?: unknown;
}

async function safeInvoke<T>(cmd: string, args?: object): Promise<T | null> {
    try {
        return await globalThis.__TAURI__.core.invoke<T>(cmd, args);
    } catch (error) {
        const tauriError = error as TauriError;
        console.error(`[Tauri] ${cmd} failed:`, tauriError.message);
        
        if (globalThis.showToast) {
            globalThis.showToast(tauriError.message, 'error');
        }
        
        return null;
    }
}
```

---

## 32. Caching Strategies

### 32.1. LocalStorage with TTL

```typescript
interface CachedData<T> {
    value: T;
    timestamp: number;
    ttl: number;  // milliseconds
}

function setWithTTL<T>(key: string, value: T, ttlMs: number): void {
    const data: CachedData<T> = {
        value,
        timestamp: Date.now(),
        ttl: ttlMs
    };
    localStorage.setItem(key, JSON.stringify(data));
}

function getWithTTL<T>(key: string): T | null {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    
    try {
        const data: CachedData<T> = JSON.parse(raw);
        const isExpired = Date.now() - data.timestamp > data.ttl;
        
        if (isExpired) {
            localStorage.removeItem(key);
            return null;
        }
        
        return data.value;
    } catch {
        return null;
    }
}
```

### 32.2. Cache Keys Convention

```typescript
// Format: {module}_{entity}_{identifier?}
const CACHE_KEYS = {
    AI_MODELS_CATALOG: 'ai_models_catalog',
    USER_PREFERENCES: 'user_preferences',
    MODULE_STATUS: (id: string) => `module_status_${id}`,
    DOWNLOAD_PROGRESS: (id: string) => `download_progress_${id}`,
} as const;
```

### 32.3. Cache Invalidation

```typescript
// ✅ Invalidate on related events
eventBus.on('module:download:complete', ({ moduleId }) => {
    localStorage.removeItem(CACHE_KEYS.MODULE_STATUS(moduleId));
    localStorage.removeItem(CACHE_KEYS.DOWNLOAD_PROGRESS(moduleId));
});

// ✅ Version-based invalidation
const CACHE_VERSION = 'v2';
const key = `${CACHE_VERSION}_${CACHE_KEYS.AI_MODELS_CATALOG}`;
```

---

## 33. Feature Flags

### 33.1. Flag Definition

```typescript
// config/featureFlags.ts
export const FEATURE_FLAGS = {
    // Enabled features
    ENABLE_VOICE_INPUT: true,
    ENABLE_DARK_MODE: true,
    
    // Experimental features (disabled by default)
    ENABLE_AI_SUGGESTIONS: false,
    ENABLE_PLUGIN_SYSTEM: false,
    
    // Rollout features (percentage-based)
    ENABLE_NEW_CHAT_UI: 0.5,  // 50% of users
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
```

### 33.2. Usage Pattern

```typescript
import { FEATURE_FLAGS } from '@/config/featureFlags';

function renderChatInput(): void {
    if (FEATURE_FLAGS.ENABLE_VOICE_INPUT) {
        renderVoiceButton();
    }
    
    // Percentage-based rollout
    if (shouldEnableFeature('ENABLE_NEW_CHAT_UI')) {
        renderNewChatUI();
    } else {
        renderLegacyChatUI();
    }
}

function shouldEnableFeature(flag: FeatureFlag): boolean {
    const value = FEATURE_FLAGS[flag];
    
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        // Consistent per-user rollout based on user ID hash
        const userId = localStorage.getItem('user_id') || 'anonymous';
        const hash = simpleHash(userId);
        return (hash % 100) / 100 < value;
    }
    
    return false;
}
```

### 33.3. Override for Testing

```typescript
// In dev mode you can override via URL params
if (import.meta.env.DEV) {
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach((value, key) => {
        if (key.startsWith('ff_')) {
            const flagName = key.slice(3).toUpperCase();
            (FEATURE_FLAGS as Record<string, boolean>)[flagName] = value === 'true';
        }
    });
}

// Usage: http://localhost:1420/?ff_enable_ai_suggestions=true
```

---

## 34. Error Monitoring & Telemetry

### 34.1. Error Classification

```typescript
enum ErrorSeverity {
    LOW = 'low',           // UI glitches, non-blocking
    MEDIUM = 'medium',     // Feature degradation
    HIGH = 'high',         // Core functionality broken
    CRITICAL = 'critical'  // App crash, data loss risk
}

interface TrackedError {
    id: string;
    message: string;
    stack?: string;
    severity: ErrorSeverity;
    context: {
        module: string;
        action: string;
        userId?: string;
        sessionId: string;
    };
    timestamp: number;
    metadata?: Record<string, unknown>;
}
```

### 34.2. Error Tracking Integration

```typescript
// ✅ Central point for all errors
class ErrorTracker {
    private static sessionId = crypto.randomUUID();
    
    static capture(
        error: Error,
        severity: ErrorSeverity,
        context: { module: string; action: string }
    ): void {
        const trackedError: TrackedError = {
            id: crypto.randomUUID(),
            message: error.message,
            stack: error.stack,
            severity,
            context: {
                ...context,
                sessionId: this.sessionId,
            },
            timestamp: Date.now(),
        };
        
        // Log locally
        errorHandler.captureError(error, context.module);
        
        // Send to backend (non-blocking)
        this.sendToBackend(trackedError).catch(() => {
            // Silent fail - don't break user experience
        });
    }
    
    private static async sendToBackend(error: TrackedError): Promise<void> {
        if (!globalThis.__TAURI__?.core) return;
        
        await globalThis.__TAURI__.core.invoke('log_error', { error });
    }
}
```

### 34.3. Performance Metrics

```typescript
// ✅ Measure critical operations
async function measureAsync<T>(
    name: string,
    operation: () => Promise<T>
): Promise<T> {
    const start = performance.now();
    
    try {
        const result = await operation();
        const duration = performance.now() - start;
        
        console.debug(`[Perf] ${name}: ${duration.toFixed(2)}ms`);
        
        // Alert if too slow
        if (duration > 1000) {
            console.warn(`[Perf] Slow operation: ${name} took ${duration}ms`);
        }
        
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        console.error(`[Perf] ${name} failed after ${duration.toFixed(2)}ms`);
        throw error;
    }
}

// Usage
const modules = await measureAsync('loadModules', () => fetchModules());
```

---

## 35. Anti-Patterns (What NOT To Do)

### 35.1. TypeScript Anti-Patterns

```typescript
// ❌ NEVER: Type assertion to bypass checks
const data = response as any as UserData;

// ❌ NEVER: Non-null assertion without proof
const element = document.getElementById('app')!;

// ❌ NEVER: Implicit any in callbacks
array.map(item => item.value);  // If 'item' is any

// ❌ NEVER: Enum with computed values
enum Status {
    Active = getActiveCode(),  // Bad
}
```

### 35.2. Memory Leak Patterns

```typescript
// ❌ NEVER: Forgotten event listeners
element.addEventListener('click', handler);
// Missing: element.removeEventListener('click', handler);

// ❌ NEVER: Uncleared intervals
const interval = setInterval(update, 1000);
// Missing: clearInterval(interval);

// ❌ NEVER: Closure over large objects
function createHandler(largeData: HugeObject) {
    return () => {
        // largeData is captured and never released
        console.log(largeData.id);
    };
}
```

### 35.3. Security Anti-Patterns

```typescript
// ❌ NEVER: Direct innerHTML with user input
element.innerHTML = userInput;

// ❌ NEVER: eval or Function constructor
eval(userCode);
new Function(userCode)();

// ❌ NEVER: Hardcoded secrets
const API_KEY = 'sk-12345...';

// ❌ NEVER: Logging sensitive data
console.log('API Key:', apiKey);
console.log('User password:', password);
```

### 35.4. Performance Anti-Patterns

```typescript
// ❌ NEVER: Sync operations in render loop
function render() {
    const data = localStorage.getItem('huge-data');  // Sync!
    JSON.parse(data);  // Expensive!
}

// ❌ NEVER: Creating functions in loops
items.forEach(item => {
    element.addEventListener('click', () => handle(item));  // New function each time
});

// ❌ NEVER: Layout thrashing
elements.forEach(el => {
    const height = el.offsetHeight;  // Read
    el.style.height = height + 10 + 'px';  // Write
    // Next iteration: read triggers forced reflow
});
```

### 35.5. Architecture Anti-Patterns

```typescript
// ❌ NEVER: God objects
class AppManager {
    handleAuth() { }
    renderUI() { }
    fetchData() { }
    manageState() { }
    logErrors() { }
    // 50+ more methods...
}

// ❌ NEVER: Circular dependencies
// fileA.ts imports fileB.ts
// fileB.ts imports fileA.ts

// ❌ NEVER: Magic strings/numbers
if (status === 3) { }  // What is 3?
if (type === 'xyz123') { }  // What is xyz123?
```
---

[↑ Back to Navigation](#-quick-navigation)

---

## 36. Clean Code & Minimalism (The Zen of Axelate)

### 36.1. The "No Dead Code" Policy (Zero Tolerance)

**We do not store trash.** Code must be alive or deleted.

> [!TIP]
> **Git Prerequisite:** This policy requires developers to be comfortable with Git.
> Before deleting code, ensure you know how to:
> - `git log -p -- file.ts` — view file history
> - `git show <commit>:file.ts` — view old version
> - `git stash` / `git stash pop` — temporary storage
> 
> Git IS your backup. You don't need commented code "just in case".

- **Prohibited:** Commented-out blocks of code (unless it's a specific example). Git is your history; you don't need to keep old chunks "just in case".
- **Prohibited:** Unused interfaces, variables, or imports.
- **Prohibited:** Methods that are never called.

```typescript
// ❌ Bad: Dead code graveyard
// function oldWay() {
//    return true;
// }

// ❌ Bad: Speculative interface (nothing uses this)
interface IFutureFeature {
    teleport(): void;
}

// ✅ Good: Only what executes runs
```

### 36.2. YAGNI (You Aren't Gonna Need It)

Do not implement features, types, or abstractions for "the future". Update standards when the need arises, not before.

- Don't create a `BaseManagerAbstractFactory` if you just need a function.
- Don't add fields to interfaces "because we might use them later".

### 36.3. Conciseness (Less is More)

**We prefer compact code.** Excessive verbosity adds noise and makes the codebase harder to scan.

- **Minimize LOC (Lines of Code).** If logic can be expressed in 1 line, do not stretch it to 5.
- **Ternaries are fine.** Use them to assign values conditionally without temporary variables.
- **Fail fast.** Return early to avoid deep nesting, but keep it short.

```typescript
// ❌ Bad: Unnecessary verbosity
let status;
if (user.isActive) {
    status = 'Active';
} else {
    status = 'Inactive';
}

// ✅ Good: Concise
const status = user.isActive ? 'Active' : 'Inactive';
```

### 36.4. The Boy Scout Rule

**"Always leave the campground cleaner than you found it."**

- If you open a file to fix a bug and see a typo in a comment — fix it.
- If you see a variable named `x` — rename it to `timeoutMs`.
- If you see dead code — delete it.
- **Small, constant improvements prevent technical debt accumulation.**

> [!WARNING]
> **Scope Limitation:** Boy Scout improvements MUST be limited to:
> - Same file you're already modifying
> - Max 10-15 lines of cleanup per PR
> - Trivial changes only (typos, naming, dead code)
> 
> **Large refactors require a separate PR** to keep Code Review focused.

---

## 37. Core Orchestrator Pattern

The `Core` class serves as the central orchestrator for the entire frontend application.

### 37.1. Purpose

- **Single Entry Point:** All services are instantiated and initialized through `Core`
- **Dependency Injection:** Services receive `Core` reference for cross-service communication
- **Boot Sequence:** Deterministic initialization order ensures dependencies are ready

### 37.2. Structure

```typescript
// src/modules/core/core.ts
class Core {
    // Services instantiated in constructor
    public readonly tauriProvider: TauriProvider;
    public readonly logger: LoggerService;
    public readonly state: StateService;
    public readonly i18n: I18nService;
    public readonly eventBus: EventBus;
    // ... more services

    constructor() {
        // 1. Instantiate services in dependency order
        this.tauriProvider = new TauriProvider();
        this.logger = new LoggerService();
        this.state = new StateService(this);
        // ...
    }

    async init(): Promise<void> {
        // 2. Initialize in specific order
        await this.state.loadState();
        await this.i18n.init();
        await this.templateLoader.init();
        // ... UI initialization
    }
}

// Register for debugging
document.addEventListener('DOMContentLoaded', () => {
    const coreInstance = new Core();
    coreInstance.init().catch(console.error);
    (globalThis as Window & { core: Core }).core = coreInstance;
});
```

### 37.3. Service Access Pattern

```typescript
// ✅ Within a service that has Core reference
class SomeService {
    constructor(private readonly _core: Core) {}

    doSomething(): void {
        this._core.logger.info('[SomeService] Action');
        this._core.state.set('key', value);
        this._core.eventBus.emit('some:event', payload);
    }
}

// ✅ Accessing from globalThis (for debugging/legacy)
window.core.logger.info('Debug message');
```

### 37.4. Boot Sequence Rules

1. **TauriProvider** — first (native bridge)
2. **LoggerService** — second (logging infrastructure)
3. **StateService** — load persisted state
4. **I18nService** — translations
5. **TemplateLoader** — HTML injection
6. **UI Services** — after templates loaded
7. **GlobalBridge** — expose APIs last

---

## 38. GlobalBridge Facade Pattern

`GlobalBridge` decouples global API exposure from the Core orchestrator.

### 38.1. Purpose

- Expose core functionality to `globalThis` for legacy code and HTML `onclick` handlers
- Group APIs by domain (Module, I18n, Window, Navigation)
- Provide type-safe interface via `IGlobalBridgeProperties`

### 38.2. Implementation

```typescript
// src/modules/core/boot/GlobalBridge.ts
class GlobalBridge {
    constructor(private readonly _core: Core) {}

    init(): void {
        this._exposeCoreGlobals();
    }

    private _exposeCoreGlobals(): void {
        const win = globalThis as unknown as IGlobalBridgeProperties;

        // Module Management
        win.downloadModule = (id, url) => this._core.moduleService.download(id, url);
        win.deleteModule = (id) => this._core.moduleService.delete(id);

        // I18n
        win.t = (key, def, ...args) => this._core.i18n.t(key, def, ...args);
        win.setLanguage = (lang) => this._core.i18n.setLanguage(lang);

        // Window Controls
        win.minimizeWindow = () => this._core.windowService.minimize();
        win.hideToTray = () => this._core.windowService.hideToTray();

        // Navigation
        win.showPage = (id, btn, isInit) => this._core.navigation.showPage(id, btn, isInit);

        // Toast API
        win.showToast = (msg, type, dur, title, id) => 
            this._core.appUI.showToast(msg, type, dur, title, id);
    }
}
```

### 38.3. Naming Convention

| Domain | Prefix | Example |
|--------|--------|---------|
| Module | `downloadModule`, `deleteModule` | `globalThis.downloadModule('gpt', url)` |
| I18n | `t`, `setLanguage` | `globalThis.t('ui.button.save', 'Save')` |
| Window | `minimizeWindow`, `hideToTray` | `globalThis.minimizeWindow()` |
| Toast | `showToast` | `globalThis.showToast('Success', 'success')` |

### 38.4. Usage in HTML

```html
<!-- ✅ Allowed for simple actions -->
<button onclick="globalThis.showPage('settings')">Settings</button>
<button onclick="globalThis.minimizeWindow()">−</button>

<!-- ✅ With i18n -->
<span data-i18n="ui.header.title">Axelate</span>
```

---

## 39. HTML Template System

Templates are loaded dynamically and injected securely using `TemplateLoader`.

### 39.1. Directory Structure

```
src/templates/
├── components/     # Reusable UI components
│   ├── header.html
│   └── sidebar.html
├── modals/         # Modal dialogs
│   └── all-modals.html
└── pages/          # Full page templates
    ├── home.html
    ├── chat.html
    ├── settings.html
    └── downloads.html
```

### 39.2. Naming Convention

| Path | Container ID |
|------|--------------|
| `pages/home.html` | `page-home` |
| `pages/settings.html` | `page-settings` |
| `components/sidebar.html` | `sidebar-container` |
| `modals/all-modals.html` | `modal-container` |

### 39.3. TemplateLoader API

```typescript
import { templateLoader } from './services/TemplateLoader';

// Load and inject in one call
await templateLoader.loadAndInject('pages/chat', 'page-chat');

// Load only (for caching)
const html = await templateLoader.loadTemplate('components/header');

// Inject with custom sanitization
templateLoader.injectTemplate('container-id', html);

// Preload critical templates
await templateLoader.preloadTemplates([
    'components/sidebar',
    'components/header',
    'pages/home'
]);

// Clear cache (e.g., on language change)
templateLoader.clearCache();
```

### 39.4. Security: DOMPurify Configuration

```typescript
// All templates are sanitized before injection
container.innerHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    ADD_TAGS: ['use', 'svg', 'path', 'symbol', 'circle', 'rect'],
    ADD_ATTR: [
        'href', 'xlink:href', 'viewBox', 'd', 'fill', 'stroke',
        'data-page', 'data-i18n', 'data-i18n-placeholder',
        'aria-label', 'aria-hidden', 'aria-current'
    ],
    ALLOW_DATA_ATTR: true,
    SAFE_FOR_TEMPLATES: true,
});
```

---

## 40. Hybrid State Persistence

State is managed through a hybrid Backend + LocalStorage strategy.

### 40.1. Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│  ┌─────────────────────────────────────────┐    │
│  │            StateService                  │    │
│  │  ┌─────────┐      ┌────────────────┐    │    │
│  │  │ _state  │ ←──→ │ localStorage   │    │    │
│  │  │ (RAM)   │      │ (Fallback)     │    │    │
│  │  └────┬────┘      └────────────────┘    │    │
│  └───────│──────────────────────────────────┘    │
│          │ invoke('get_ui_state')                │
│          │ invoke('save_ui_state')               │
│          ▼                                       │
├─────────────────────────────────────────────────┤
│                   Backend (Rust)                 │
│  ┌─────────────────────────────────────────┐    │
│  │          ui_state.rs                     │    │
│  │     Source of Truth (JSON file)          │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 40.2. State Interface

```typescript
interface IUIState {
    sidebar_collapsed: boolean;
    sidebar_width: number;
    hidden_nav_items: string[];
    hidden_monitors: string[];
    card_widths: Record<string, string>;
    download_limit_enabled: boolean;
    download_max_speed: number;
    selected_modules: Record<string, Partial<IApp>>;
    last_page?: string;
}
```

### 40.3. Usage Pattern

```typescript
// ✅ Read state
const width = this._core.state.getSidebarWidth();
const modules = this._core.state.getSelectedModules();

// ✅ Write state (auto-debounced save)
this._core.state.setSidebarWidth(320);
this._core.state.setSelectedModule('api', { id: 'gpt', name: 'GPT-4' });

// ✅ Generic get/set
this._core.state.set('hidden_monitors', ['cpu', 'gpu']);
const hidden = this._core.state.get('hidden_monitors');
```

### 40.4. Persistence Strategy

| Event | Action |
|-------|--------|
| `state.set()` | Mark dirty, schedule debounced save (500ms) |
| `beforeunload` | Immediate synchronous save |
| `visibilitychange` (hidden) | Immediate async save |
| App startup | Load from backend, fallback to localStorage |

---

## 41. Module Controller Pattern (MVC)

Modules follow a Controller → Service + UI separation.

### 41.1. Structure

```
modules/{module}/
├── index.ts              # Public exports
├── {module}.ts           # Controller (optional, for complex modules)
├── services/
│   └── {Module}Service.ts  # Business logic, backend calls
├── ui/
│   └── {Module}UI.ts       # DOM manipulation, rendering
├── types/
│   └── {module}Types.ts    # TypeScript interfaces
└── utils/
    └── {module}Utils.ts    # Helper functions
```

### 41.2. Controller Responsibilities

```typescript
// src/modules/chat/chat.ts
class ChatController {
    private readonly _service: ChatService;
    private readonly _ui: ChatUI;

    constructor() {
        this._service = new ChatService();
        this._ui = new ChatUI();
        this._init();
    }

    private _init(): void {
        this._bindEvents();
        this._exposeGlobals();
    }

    private _bindEvents(): void {
        // DOM event bindings
        document.getElementById('chat-send')
            ?.addEventListener('click', () => this.sendChat());
    }

    private _exposeGlobals(): void {
        // Legacy support
        (globalThis as unknown as Record<string, unknown>).sendChat = 
            () => this.sendChat();
    }

    async sendChat(): Promise<void> {
        const text = this._ui.getInputText();
        const response = await this._service.send(text);
        this._ui.renderResponse(response);
    }
}
```

### 41.3. Service vs UI Separation

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **Service** | Backend calls, business logic, data transforms | `ChatService.send()`, `ModuleService.download()` |
| **UI** | DOM queries, rendering, animations | `ChatUI.renderMessage()`, `SettingsUI.showTab()` |
| **Controller** | Coordination, event binding, state flow | `ChatController.sendChat()` |

### 41.4. When to Use Controller

- **With Controller:** Complex modules with multiple UI components and services (Chat, Settings)
- **Without Controller:** Simple modules where Service + UI are sufficient (Debug, Monitoring)

### 41.5. Lightweight Module Pattern (Simplified)

For simple features that do not require complex state management or backend orchestration, you may merge Logic and UI into a single class or use a functional approach to avoid boilerplate.

**Criteria for Use:**
- No dedicated backend service required (or uses shared Global services).
- No complex internal state machine.
- Single UI view/component.

```typescript
// modules/clock/ClockModule.ts
export class ClockModule {
    private _el: HTMLElement | null = null;
    
    constructor(private readonly _core: Core) {}
    
    init(): void {
        this._el = document.getElementById('clock-widget');
        this._startTicker();
    }
    
    private _startTicker(): void {
        setInterval(() => {
             if(this._el) this._el.textContent = new Date().toLocaleTimeString();
        }, 1000);
    }
}
```

---

## 42. AI Streaming Architecture

Real-time AI responses use IPC streaming via Tauri events.

### 42.1. Data Flow

```
┌────────────────────────────────────────────────────────────┐
│                        Frontend                             │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────┐   │
│  │  ChatUI      │◄───│  AIBridge   │◄───│ Tauri Event  │   │
│  │  (render)    │    │  (buffer)   │    │ Listener     │   │
│  └──────────────┘    └──────┬──────┘    └──────────────┘   │
│                             │ invoke('send_chat_message')   │
│                             ▼                               │
├────────────────────────────────────────────────────────────┤
│                        Backend (Rust)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   ai_service.rs                      │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │   │
│  │  │ OpenAI SSE │  │ Gemini SSE │  │ Local LLM  │     │   │
│  │  │ Stream     │  │ Stream     │  │ Stream     │     │   │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘     │   │
│  │        │               │               │             │   │
│  │        └───────────────┴───────────────┘             │   │
│  │                        │                             │   │
│  │              window.emit("ai:thought:chunk")         │   │
│  │              window.emit("ai:thought:done")          │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 42.2. Frontend: AIBridge

```typescript
// src/modules/ai/AIBridge.ts
class AIBridge {
    private _streamBuffer = '';
    private _onChunk: ((chunk: string) => void) | null = null;

    async init(): Promise<void> {
        // Subscribe to streaming events
        await globalThis.__TAURI__.event.listen<string>(
            'ai:thought:chunk',
            (event) => {
                this._streamBuffer += event.payload;
                this._onChunk?.(event.payload);
            }
        );

        await globalThis.__TAURI__.event.listen<void>(
            'ai:thought:done',
            () => this._finalizeStream()
        );
    }

    async sendMessage(
        text: string,
        source: MessageSource = 'chat',
        attachments: Attachment[] = []
    ): Promise<string> {
        this._streamBuffer = '';

        const request: IChatRequest = {
            provider: this._activeProviderId,
            model: this._selectedModel,
            api_key: this._apiKey,
            messages: this._history,
            // ...
        };

        await globalThis.__TAURI__.core.invoke('send_chat_message', { request });
        return this._streamBuffer;
    }
}
```

### 42.3. Backend: Rust Streaming

```rust
// src-tauri/src/services/ai_service.rs
#[tauri::command]
pub async fn send_chat_message(
    window: tauri::Window,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    let client = Client::new();
    
    // Stream response chunks
    let mut stream = client.post(&url)
        .json(&body)
        .send()
        .await?
        .bytes_stream();

    while let Some(chunk) = stream.next().await {
        let text = parse_sse_chunk(&chunk?);
        // Emit to frontend
        window.emit("ai:thought:chunk", &text).ok();
    }

    window.emit("ai:thought:done", ()).ok();
    Ok(ChatResponse { /* ... */ })
}
```

### 42.4. Event Naming

| Event | Payload | Description |
|-------|---------|-------------|
| `ai:thought:chunk` | `string` | Incremental text chunk |
| `ai:thought:done` | `void` | Stream completed |
| `ai:thought:error` | `{ code: string, message: string }` | Stream error |

---

## 43. Window Lifecycle & System Tray

Tauri window management with system tray integration.

### 43.1. Window States

```
                    ┌──────────────┐
                    │   Running    │
                    │  (Visible)   │
                    └──────┬───────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Minimized   │  │   Hidden     │  │   Closed     │
│ (Taskbar)    │  │ (Tray Only)  │  │ (WebView     │
│              │  │ WebView Alive│  │  Destroyed)  │
└──────────────┘  └──────────────┘  └──────────────┘
         │                 │                 │
         │                 │                 │
         └─────────────────┴─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Tray Menu:  │
                    │  "Открыть"   │──────► Recreate Window
                    │  "Выход"     │──────► Full Exit
                    └──────────────┘
```

### 43.2. Commands

| Command | Effect | WebView Status |
|---------|--------|----------------|
| `minimize_window` | Hide to taskbar | Alive |
| `hide_window` | Hide completely, keep alive | Alive |
| `close_window` | Destroy WebView, stay in tray | Destroyed |
| `show_window` | Restore from hidden/minimized | Alive |

### 43.3. Frontend Usage

```typescript
// src/modules/core/services/WindowService.ts
class WindowService {
    async minimize(): Promise<void> {
        await this._invoke('minimize_window');
    }

    async hideToTray(): Promise<void> {
        await this._invoke('hide_window');
        // Pause monitoring to save resources
        await this._invoke('set_monitoring_paused', { paused: true });
    }

    async confirmClose(): Promise<void> {
        // Save state before closing
        this._core.state.saveImmediate();
        await this._invoke('close_window');
    }
}
```

### 43.4. Backend: Tray Integration

```rust
// src-tauri/src/lib.rs
fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;

    TrayIconBuilder::new()
        .menu(&Menu::with_items(app, &[&show_item, &quit_item])?)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.show().ok();
                        window.set_focus().ok();
                    } else {
                        // Recreate window if destroyed
                        create_main_window(app);
                    }
                }
                "quit" => {
                    IS_QUITTING.store(true, Ordering::Relaxed);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}
```

### 43.5. Global Shortcut

- **Ctrl+Space:** Toggle window visibility
- Only works if WebView is alive
- If destroyed, shortcut is ignored (user must use tray)

---

## 44. Secure Storage Pattern

API keys and secrets are stored using platform-native secure storage.

### 44.1. Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Frontend                           │
│  ┌────────────────────────────────────────────────┐    │
│  │              axelateAPI.secureStorage              │    │
│  │  save(service, key) → invoke('save_secure_key') │    │
│  │  get(service) → invoke('get_secure_key')        │    │
│  └─────────────────────────┬──────────────────────┘    │
│                            │                            │
├────────────────────────────┼────────────────────────────┤
│                      Backend (Rust)                     │
│  ┌─────────────────────────▼──────────────────────┐    │
│  │            secure_storage.rs                    │    │
│  │  ┌─────────────────────────────────────────┐   │    │
│  │  │ Windows: Credential Manager              │   │    │
│  │  │ macOS: Keychain                          │   │    │
│  │  │ Linux: libsecret/kwallet                 │   │    │
│  │  └─────────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

### 44.2. Frontend API

```typescript
// Exposed via GlobalBridge
interface SecureStorageAPI {
    save: (service: string, key: string) => Promise<void>;
    get: (service: string) => Promise<string | null>;
}

// Usage in AIBridge
async function saveApiKey(providerId: string, key: string): Promise<void> {
    await globalThis.axelateAPI.secureStorage.save(`axelate_${providerId}`, key);
}

async function getApiKey(providerId: string): Promise<string | null> {
    return globalThis.axelateAPI.secureStorage.get(`axelate_${providerId}`);
}
```

### 44.3. Service Naming Convention

| Provider | Service Name | Purpose |
|----------|--------------|---------|
| OpenAI | `axelate_openai` | GPT API key |
| Google | `axelate_gemini` | Gemini API key |
| Anthropic | `axelate_claude` | Claude API key |
| Custom | `axelate_{provider_id}` | Custom provider key |

### 44.4. Security Rules

- ❌ **NEVER** store API keys in `localStorage`
- ❌ **NEVER** log API keys to console
- ❌ **NEVER** include keys in error messages
- ✅ Use `axelateAPI.secureStorage` for all credentials
- ✅ Keys are encrypted at rest by OS
- ✅ Access controlled by OS permissions

### 44.5. Backend Commands

```rust
// src-tauri/src/commands/secure.rs
#[tauri::command]
pub async fn save_secure_key(service: String, key: String) -> Result<(), String> {
    crate::services::secure_storage::set_password(&service, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_secure_key(service: String) -> Result<Option<String>, String> {
    crate::services::secure_storage::get_password(&service)
        .map_err(|e| e.to_string())
}
```

---

## 45. Observer Pattern (Pub/Sub Services)

Services that emit data over time implement the Observer pattern for loose coupling.

### 45.1. Interface

```typescript
interface IObservable<T> {
    subscribe(callback: (data: T) => void): void;
    unsubscribe(callback: (data: T) => void): void;
}
```

### 45.2. Implementation

```typescript
// src/modules/monitoring/services/MonitoringService.ts
export class MonitoringService {
    private listeners: StatsCallback[] = [];

    public subscribe(callback: StatsCallback): void {
        if (!this.listeners.includes(callback)) {
            this.listeners.push(callback);
        }
    }

    public unsubscribe(callback: StatsCallback): void {
        this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    private notifyListeners(stats: ISystemStats): void {
        this.listeners.forEach((cb) => {
            try {
                cb(stats);
            } catch (err) {
                console.error('[MonitoringService] Listener error:', err);
            }
        });
    }
}
```

### 45.3. Lifecycle Methods

| Method | Purpose |
|--------|---------|
| `startMonitoring()` | Begin emitting data |
| `stopMonitoring()` | Stop emission, cleanup listeners |
| `destroy()` | Full cleanup, clear all subscribers |

### 45.4. Usage

```typescript
const monitor = new MonitoringService();
const handler = (stats: ISystemStats) => console.log(stats);

monitor.subscribe(handler);
await monitor.startMonitoring();

// Later...
monitor.unsubscribe(handler);
monitor.destroy();
```

---

## 46. Global Error Boundaries

Centralized error capture prevents unhandled exceptions from crashing the app.

### 46.1. Initialization

```typescript
// src/modules/core/services/ErrorHandler.ts
class ErrorHandler {
    public init(): void {
        // Catch uncaught errors
        globalThis.onerror = (message, source, lineno, colno, error) => {
            this.captureError(error || new Error(String(message)), 'window.onerror');
            return false;
        };

        // Catch unhandled promise rejections
        globalThis.onunhandledrejection = (event) => {
            const error = event.reason instanceof Error 
                ? event.reason 
                : new Error(String(event.reason));
            this.captureError(error, 'unhandledrejection');
        };
    }
}
```

### 46.2. Error Capture

```typescript
public captureError(error: Error, context?: string): void {
    const errorInfo: IErrorInfo = {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: Date.now(),
    };

    // Log with rotation
    this._errorLog.push(errorInfo);
    if (this._errorLog.length > this._maxLogSize) {
        this._errorLog.shift();
    }

    // Emit for subscribers
    eventBus.emit('error:global', { error, context });

    // Show toast
    this._showErrorToast(error.message);
}
```

### 46.3. Safe Wrappers

```typescript
// Wrap async functions
public async wrapAsync<T>(fn: () => Promise<T>, context?: string): Promise<T | undefined> {
    try {
        return await fn();
    } catch (error) {
        this.captureError(error instanceof Error ? error : new Error(String(error)), context);
        return undefined;
    }
}

// Wrap event handlers
public safeHandler<T extends Event>(
    handler: (event: T) => void,
    context?: string
): (event: T) => void {
    return (event: T) => {
        try {
            handler(event);
        } catch (error) {
            this.captureError(error instanceof Error ? error : new Error(String(error)), context);
        }
    };
}
```

### 46.4. Usage

```typescript
// Safe async call
await errorHandler.wrapAsync(() => fetchData(), 'fetchData');

// Safe event handler
button.addEventListener('click', errorHandler.safeHandler(handleClick, 'buttonClick'));
```

---

## 47. DOM Selector Constants

Centralize DOM element selectors for consistency and testability.

### 47.1. Pattern

```typescript
// src/modules/downloader/ui/DownloadUI.ts
class DownloadUI {
    private static readonly SELECTORS = {
        PROGRESS_BAR: 'downloads-progress-bar',
        PROGRESS_TEXT: 'downloads-progress-text',
        SPEED_LABEL: 'downloads-speed',
        STATUS_LABEL: 'downloads-status',
        ETA_LABEL: 'downloads-eta',
        EMPTY_TEXT: 'downloads-empty-text',
        MAIN_CARD: 'module-downloads-card',
        CONTAINER: 'downloads-container',
    } as const;
}
```

### 47.2. Element Factory

```typescript
private _getElements() {
    const S = DownloadUI.SELECTORS;
    return {
        bar: document.getElementById(S.PROGRESS_BAR),
        text: document.getElementById(S.PROGRESS_TEXT),
        speedEl: document.getElementById(S.SPEED_LABEL),
        statusEl: document.getElementById(S.STATUS_LABEL),
        etaEl: document.getElementById(S.ETA_LABEL),
        emptyText: document.getElementById(S.EMPTY_TEXT),
        mainCard: document.getElementById(S.MAIN_CARD),
        downloadsContainer: document.getElementById(S.CONTAINER),
    };
}
```

### 47.3. Benefits

- **Testability:** Easy to mock or query in tests
- **Refactoring:** Change ID in one place
- **Type Safety:** `as const` gives literal types
- **Documentation:** Self-documenting element purposes

---

## 48. Markdown Rendering Pipeline

Rich text rendering with extensions and security.

### 48.1. Configuration

```typescript
// src/modules/chat/ui/ChatUI.ts
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';

// Configure extensions
marked.use(markedAlert());
marked.use(markedKatex({ throwOnError: false }));
marked.use(markedFootnote());
marked.use({
    breaks: true,
    gfm: true,
});
```

### 48.2. Custom Renderers

```typescript
// Custom code block renderer
marked.use({
    renderer: {
        code({ text, lang }) {
            const escaped = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            return `
                <div class="code-block" data-language="${lang || 'text'}">
                    <div class="code-header">
                        <span class="code-lang">${lang || 'text'}</span>
                        <button class="btn-copy">Copy</button>
                    </div>
                    <pre><code class="hljs">${escaped}</code></pre>
                </div>
            `;
        },
    },
});
```

### 48.3. Security: Post-Render Sanitization

```typescript
const rendered = marked.parse(content);
const sanitized = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'data-language'],
});
container.innerHTML = sanitized;
```

### 48.4. Streaming Updates

```typescript
createStreamingMessage() {
    let buffer = '';
    
    return {
        update(chunk: string) {
            buffer += chunk;
            // Parse incrementally
            textNode.innerHTML = DOMPurify.sanitize(marked.parse(buffer));
        },
        finalize(fullContent: string) {
            textNode.innerHTML = DOMPurify.sanitize(marked.parse(fullContent));
        },
    };
}
```

---

## 49. Toast Queue System

Managed toast notifications with update and queue support.

### 49.1. Structure

```typescript
// src/modules/core/ui/AppUI.ts
type ToastElement = HTMLDivElement & {
    _timeout?: ReturnType<typeof setTimeout>;
};

class AppUI {
    private toastQueue: ToastElement[] = [];
}
```

### 49.2. Show Toast

```typescript
showToast(
    message: string,
    type: string = 'info',
    duration: number = 3000,
    title: string | null = null,
    id: string | null = null,
) {
    const container = this._ensureToastContainer();

    // Update existing toast if ID matches
    if (id) {
        const existing = this.toastQueue.find((t) => t.id === id);
        if (existing) {
            this._updateExistingToast(existing, message, title, duration);
            return;
        }
    }

    // Create new toast
    this._createToast(container, message, type, duration, title, id);
}
```

### 49.3. Update Existing Toast

```typescript
private _updateExistingToast(
    toast: ToastElement,
    message: string,
    title: string | null,
    duration: number,
) {
    // Update content
    const msgEl = toast.querySelector('.toast-message');
    if (msgEl) msgEl.textContent = message;

    const titleEl = toast.querySelector('.toast-title');
    if (titleEl && title) titleEl.textContent = title;

    // Reset timeout
    if (toast._timeout) clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => this._removeToast(toast), duration);
}
```

### 49.4. Container Lazy Creation

```typescript
private _ensureToastContainer(): HTMLElement {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}
```

---

## 50. Visibility-Based Resource Optimization

Pause expensive operations when the window is hidden.

### 50.1. Frontend Implementation

```typescript
// src/modules/monitoring/services/MonitoringService.ts
private _bindVisibilityHandler(): void {
    document.addEventListener('visibilitychange', () => {
        const isHidden = document.hidden;
        
        // Notify backend to pause/resume
        void globalThis.__TAURI__.core.invoke('set_monitoring_paused', { 
            paused: isHidden 
        });

        if (import.meta.env.DEV) {
            console.debug(`[MonitoringService] Backend paused: ${isHidden}`);
        }
    });
}
```

### 50.2. Backend Implementation

```rust
// src-tauri/src/services/system_monitor.rs
static MONITORING_PAUSED: AtomicBool = AtomicBool::new(false);

pub fn set_paused(paused: bool) {
    MONITORING_PAUSED.store(paused, Ordering::Relaxed);
    if paused {
        // Free resources when paused
        if let Ok(mut mon) = MONITOR.lock() {
            mon.drop_resources();
        }
    }
}
```

### 50.3. Resource Management

```rust
impl Monitor {
    fn ensure_resources(&mut self) {
        if self.sys.is_none() {
            self.sys = Some(System::new_with_specifics(
                RefreshKind::new()
                    .with_cpu(CpuRefreshKind::everything())
                    .with_memory(MemoryRefreshKind::everything())
            ));
        }
    }

    fn drop_resources(&mut self) {
        self.sys = None;
        self.networks = None;
        self.disks = None;
        self.nvml = None;
    }
}
```

### 50.4. Benefits

- **CPU Savings:** No polling when app hidden
- **Memory Savings:** Drop sysinfo handles
- **Battery Life:** Reduced background activity
- **Instant Resume:** Re-initialize on visibility restore

---

## 51. Backend System Monitor Loop (Rust)

Continuous system metrics emission with graceful lifecycle.

### 51.1. Global State

```rust
// src-tauri/src/services/system_monitor.rs
use once_cell::sync::Lazy;
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};

static MONITOR: Lazy<Mutex<Monitor>> = Lazy::new(|| {
    Mutex::new(Monitor {
        sys: None,
        networks: None,
        disks: None,
        nvml: None,
        // ... cached values
    })
});

static MONITORING_ACTIVE: AtomicBool = AtomicBool::new(false);
static MONITORING_PAUSED: AtomicBool = AtomicBool::new(false);
```

### 51.2. Monitor Loop

```rust
pub fn start_monitoring(app: AppHandle, interval_ms: u64) {
    if MONITORING_ACTIVE.swap(true, Ordering::Relaxed) {
        return; // Already running
    }

    std::thread::spawn(move || {
        while MONITORING_ACTIVE.load(Ordering::Relaxed) {
            if !MONITORING_PAUSED.load(Ordering::Relaxed) {
                let stats = get_stats();
                let _ = app.emit("system_stats", &stats);
            }
            std::thread::sleep(Duration::from_millis(interval_ms));
        }
    });
}
```

### 51.3. Graceful Shutdown

```rust
pub fn stop_monitoring() {
    MONITORING_ACTIVE.store(false, Ordering::Relaxed);
}
```

### 51.4. Stats Collection

```rust
pub fn get_stats() -> SystemStats {
    let mut mon = MONITOR.lock().unwrap();
    mon.ensure_resources();

    SystemStats {
        cpu: collect_cpu_stats(&mut mon),
        ram: collect_ram_stats(&mut mon),
        gpu: collect_gpu_stats(&mut mon),
        disk: collect_disk_stats(&mut mon),
        network: collect_network_stats(&mut mon),
        pid: std::process::id(),
    }
}
```

---

## 52. Module Controller Pattern (Rust)

Unified command dispatcher for module lifecycle management.

### 52.1. Action Enum

```rust
// src-tauri/src/services/module_controller.rs
#[derive(Debug)]
pub enum ModuleAction {
    Start,
    Stop,
    Restart,
    Install,
    Uninstall,
    Update,
}

impl FromStr for ModuleAction {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "start" => Ok(Self::Start),
            "stop" => Ok(Self::Stop),
            "restart" => Ok(Self::Restart),
            "install" => Ok(Self::Install),
            "uninstall" => Ok(Self::Uninstall),
            "update" => Ok(Self::Update),
            _ => Err(AppError::InvalidInput(format!("Unknown action: {}", s))),
        }
    }
}
```

### 52.2. Control Dispatcher

```rust
pub fn control(
    app: AppHandle,
    module_id: &str,
    action: ModuleAction,
) -> Result<ControlResponse, AppError> {
    match action {
        ModuleAction::Start => start_module(module_id),
        ModuleAction::Stop => stop_module(module_id),
        ModuleAction::Restart => {
            stop_module(module_id)?;
            start_module(module_id)
        }
        ModuleAction::Install => downloader::install_module(&app, module_id),
        ModuleAction::Uninstall => module_lifecycle::uninstall(module_id),
        ModuleAction::Update => {
            module_lifecycle::uninstall(module_id)?;
            downloader::install_module(&app, module_id)
        }
    }
}
```

### 52.3. Status Check

```rust
pub fn get_module_status(module_id: &str) -> String {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    for (pid, proc) in sys.processes() {
        if proc.name().to_string_lossy().contains(module_id) {
            return format!("running:{}", pid);
        }
    }
    
    "stopped".to_string()
}
```

### 52.4. Frontend Usage

```typescript
// Start a module
await invoke('control_module', { 
    moduleId: 'sd', 
    action: 'start' 
});

// Get status
const status = await invoke<string>('get_module_status', { 
    moduleId: 'sd' 
});
```

---

## 53. TauriProvider Abstraction Layer

A unified abstraction for accessing Tauri APIs with fallback support.

### 53.1. Core Structure

```typescript
// src/modules/core/services/TauriProvider.ts
export class TauriProvider {
    private readonly _tauri: ITauriInstance | undefined;

    constructor() {
        const win = globalThis as unknown as ITauriGlobal;
        this._tauri = win.__TAURI__;
    }

    public isTauri(): boolean {
        const win = globalThis as unknown as ITauriGlobal;
        return !!win.__TAURI__;
    }
}
```

### 53.2. Unified Invoke

```typescript
public async invoke<T, A extends Record<string, unknown>>(
    cmd: string,
    args: A = {} as A,
): Promise<T> {
    const tauri = (globalThis as ITauriGlobal).__TAURI__;

    if (tauri) {
        // Support both Tauri v2 (core.invoke) and v1 (invoke)
        const invokeFn = tauri.core?.invoke || tauri.invoke;
        return await invokeFn(cmd, args) as T;
    } else {
        return this._mockInvoke(cmd, args);
    }
}
```

### 53.3. Event Listening

```typescript
public async listen<T>(
    event: string, 
    callback: (payload: T) => void
): Promise<() => void> {
    const tauri = (globalThis as ITauriGlobal).__TAURI__;
    
    if (tauri) {
        return await tauri.event.listen<T>(event, (e) => callback(e.payload));
    } else {
        console.log(`[TauriProvider] Mock Listen: ${event}`);
        return () => {};
    }
}
```

### 53.4. Benefits

- **Environment Agnostic:** Same API for Tauri and web
- **Version Compatibility:** Supports Tauri v1 and v2
- **Centralized Logging:** Debug all IPC in one place
- **Testability:** Easy to mock in unit tests

---

## 54. Mock Development Mode

Development-time stubs for Tauri commands.

### 54.1. Pattern

```typescript
// src/modules/core/services/TauriProvider.ts
private async _mockInvoke<T>(cmd: string, args: unknown): Promise<T> {
    if (!import.meta.env.DEV) {
        console.warn('[TauriProvider] Mock invoked in production!');
        return null as T;
    }
    console.log(`[Mock Invoke] ${cmd}`, args);

    switch (cmd) {
        case 'get_settings':
            return { LANGUAGE: 'en', THEME: 'dark' } as T;
        case 'get_translations':
            return {} as T;
        case 'get_modules':
            return [] as T;
        case 'get_system_stats':
            return {
                cpu: { percent: 15 },
                ram: { percent: 40, used_gb: 8, total_gb: 32 },
                gpu: { usage: 20 },
            } as T;
        default:
            return null as T;
    }
}
```

### 54.2. Rules

| Rule | Description |
|------|-------------|
| **DEV Only** | Guard with `import.meta.env.DEV` |
| **Realistic Data** | Return plausible mock values |
| **Log All Calls** | Console log for debugging |
| **Type Safety** | Cast return to `T` |

### 54.3. Usage

```typescript
// Works seamlessly in browser dev mode
const settings = await tauri.invoke<ISettings>('get_settings');
// Returns mock: { LANGUAGE: 'en', THEME: 'dark' }
```

---

## 55. Navigation History Stack

Browser-like navigation with back/forward support.

### 55.1. Structure

```typescript
// src/modules/core/services/NavigationService.ts
export class NavigationService {
    private readonly _historyStack: string[] = [];
    private _currentIndex: number = -1;
    private static _instance: NavigationService;

    private constructor() {
        if (NavigationService._instance) {
            console.warn('[NavigationService] Instance already exists!');
        }
        NavigationService._instance = this;
    }

    public static getInstance(): NavigationService {
        if (!NavigationService._instance) {
            NavigationService._instance = new NavigationService();
        }
        return NavigationService._instance;
    }
}
```

### 55.2. Navigate with Forward-History Truncation

```typescript
public navigate(pageId: string): void {
    // Clear forward history when navigating to new page
    if (this._currentIndex < this._historyStack.length - 1) {
        this._historyStack.splice(this._currentIndex + 1);
    }
    this._historyStack.push(pageId);
    this._currentIndex = this._historyStack.length - 1;
}
```

### 55.3. Back/Forward Navigation

```typescript
public goBack(): void {
    if (this._currentIndex > 0) {
        this._currentIndex--;
        // Trigger page change via event or direct call
    }
}

public goForward(): void {
    if (this._currentIndex < this._historyStack.length - 1) {
        this._currentIndex++;
    }
}
```

### 55.4. State Restoration

```typescript
public refreshFromUiState(): void {
    const lastPage = window.uiState?.getLastPage();
    if (lastPage) {
        this._historyStack.push(lastPage);
        this._currentIndex = this._historyStack.length - 1;
    }
}
```

---

## 56. Catalog Schema Hydration

Dynamic configuration schema generation from backend data.

### 56.1. Fetch and Merge Pattern

```typescript
// src/modules/core/services/CatalogService.ts
public async loadCatalog(): Promise<void> {
    const config = await this._tauri.invoke<IAppConfig>('get_config');
    const installedModules = await this._tauri.invoke<IModule[]>('get_modules');

    // O(1) lookup for installed status
    const installedMap = new Map(installedModules.map((m) => [m.id, m]));

    const mergeSchema = (list: IApp[]) => {
        list.forEach((app) => {
            // Dynamic schema from providers
            const provider = config.api_providers?.find((p) => p.id === app.id);
            if (provider) {
                app.config_schema = {
                    api_key: {
                        label: `${provider.name} API Key`,
                        field_type: 'text',
                        required: true,
                    },
                };
            }

            // Mark installed
            if (installedMap.has(app.id)) {
                app.installed = true;
            }
        });
    };

    mergeSchema(this._appData.ai);
    mergeSchema(this._appData.services);
}
```

### 56.2. Global Synchronization

```typescript
private _syncToGlobal(): void {
    const win = globalThis as ICatalogGlobal;
    if (win.APP_DATA) {
        win.APP_DATA.ai = this._appData.ai;
        win.APP_DATA.services = this._appData.services;
    }
}
```

### 56.3. Event Broadcasting

```typescript
// Notify other modules that catalog is ready
globalThis.dispatchEvent(new CustomEvent('catalog-loaded'));
```

---

## 57. Parameterized Translation (I18n)

Internationalization with parameter interpolation and fallback chain.

### 57.1. Translation Function

```typescript
// src/modules/core/services/I18nService.ts
public t(
    key: string, 
    defaultText: string = '', 
    params: Record<string, unknown> = {}
): string {
    let text = this._translations[key] || defaultText || key;

    // Parameter interpolation: {name} → value
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
    }
    return text;
}
```

### 57.2. Fallback Chain

```typescript
public async loadTranslations(lang: string): Promise<void> {
    let base: Record<string, string> = {};
    let target: Record<string, string> = {};

    // 1. Always load English as base
    base = await this._fetchTranslations('en');

    // 2. Load target language if different
    if (lang !== 'en') {
        target = await this._fetchTranslations(lang);
    }

    // 3. Merge: target overrides base
    this._translations = { ...base, ...target };
    this._currentLang = lang;
    document.documentElement.lang = lang;
}
```

### 57.3. Backend Sync

```typescript
private async _syncToBackend(lang: string): Promise<void> {
    await this._tauri.invoke('save_setting', { 
        key: 'LANGUAGE', 
        value: lang 
    });
}
```

### 57.4. Usage

```typescript
// Simple translation
i18n.t('ui.welcome', 'Welcome');

// With parameters
i18n.t('ui.greeting', 'Hello, {name}!', { name: 'User' });
// → "Hello, User!"
```

---

## 58. Console Interceptors

Capture and redirect console output for centralized logging.

### 58.1. Setup

```typescript
// src/modules/core/services/LoggerService.ts
private _setupInterceptors(): void {
    // Save original methods
    const originalError = console.error;
    const originalWarn = console.warn;

    // Intercept console.error
    console.error = (...args: unknown[]) => {
        this.log('ERROR', this._formatMessage(args[0] as string, args.slice(1)));
        originalError.apply(console, args);
    };

    // Intercept console.warn
    console.warn = (...args: unknown[]) => {
        this.log('WARN', this._formatMessage(args[0] as string, args.slice(1)));
        originalWarn.apply(console, args);
    };
}
```

### 58.2. Global Error Hooks

```typescript
// Uncaught errors
globalThis.onerror = (message, source, lineno, colno, error) => {
    this.log('ERROR', `Uncaught: ${message} at ${source}:${lineno}:${colno}`);
    return false; // Don't suppress default handling
};

// Unhandled promise rejections
globalThis.onunhandledrejection = (event) => {
    this.log('ERROR', `Unhandled rejection: ${event.reason}`);
};
```

### 58.3. Sensitive Data Redaction

```typescript
private _redact(key: string, value: unknown): unknown {
    const sensitiveKeys = ['password', 'api_key', 'token', 'secret'];
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        return '[REDACTED]';
    }
    return value;
}
```

### 58.4. On-Screen Debug Overlay

```typescript
private _logToScreen(level: string, message: string): void {
    if (!import.meta.env.DEV) return;
    
    let overlay = document.getElementById('debug-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'debug-overlay';
        overlay.className = 'debug-overlay';
        document.body.appendChild(overlay);
    }

    const entry = document.createElement('div');
    entry.className = `log-${level.toLowerCase()}`;
    entry.textContent = `[${level}] ${message}`;
    overlay.appendChild(entry);
}
```

---

## 59. Incremental Log Fetch & Filtering

Efficient log retrieval with delta updates and noise filtering.

### 59.1. Delta Fetch

```typescript
// src/modules/debug/services/DebugService.ts
export class DebugService {
    private logs: ILogEntry[] = [];
    private lastTimestamp = 0;

    public async fetchLogs(): Promise<ILogEntry[]> {
        const logs = await invoke<ILogEntry[]>('get_logs', {
            since: this.lastTimestamp,
        });
        return this.processLogs(logs);
    }
}
```

### 59.2. Pattern-Based Filtering

```typescript
private processLogs(newLogs: ILogEntry[]): ILogEntry[] {
    const filteredLogs = newLogs.filter((log) => {
        const msg = (log.message || '').toUpperCase();
        const src = (log.source || '').toUpperCase();

        // Skip AI service noise
        const isBotSource = 
            src.includes('CHATSERVICE') ||
            src.includes('AIBRIDGE');

        // Skip common HTTP errors
        const isAIError =
            msg.includes('ERROR 429') ||
            msg.includes('ERROR 400') ||
            msg.includes('QUOTA');

        return !(isBotSource || isAIError);
    });

    this.logs.push(...filteredLogs);
    this.lastTimestamp = newLogs.at(-1)?.timestamp ?? this.lastTimestamp;
    return filteredLogs;
}
```

### 59.3. Ring Buffer

```typescript
// Keep only last 1000 logs to prevent memory growth
if (this.logs.length > 2000) {
    this.logs = this.logs.slice(-1000);
}
```

### 59.4. Safe JSON Parsing

```typescript
private safeJsonParse(text: string, defaultValue: unknown): unknown {
    try {
        return text ? JSON.parse(text) : defaultValue;
    } catch {
        return defaultValue;
    }
}
```

---

## 60. Service-to-Bridge Delegation

Thin service layer that delegates complex operations to global bridges.

### 60.1. Pattern

```typescript
// src/modules/chat/services/ChatService.ts
export class ChatService {
    public async sendMessage(
        text: string,
        history: IChatMessage[],
        attachments: IChatAttachment[],
    ): Promise<IChatResponse> {
        // Validate input
        if (!text?.trim() && !attachments?.length) {
            return { ok: false, error: 'Message is empty' };
        }

        // Check bridge availability
        const aiBridge = (globalThis as any).aiBridge;
        if (!aiBridge) {
            return { ok: false, error: 'AI Bridge not initialized' };
        }

        // Check active provider
        if (!aiBridge.isActive?.()) {
            return { ok: false, error: 'No AI module running' };
        }

        // Delegate to bridge
        try {
            const response = await aiBridge.sendMessage(text, 'chat', attachments);
            
            // Handle error prefix
            if (response.startsWith('Error: ')) {
                return { ok: false, error: response.replace('Error: ', '') };
            }
            
            return { ok: true, message: response };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
}
```

### 60.2. Benefits

- **Separation of Concerns:** Module logic vs AI internals
- **Testability:** Easy to mock `aiBridge`
- **Error Normalization:** Consistent `IChatResponse` format
- **Guard Clauses:** Fail fast with clear error messages

### 60.3. When to Use

| Use Case | Approach |
|----------|----------|
| Simple IPC | Direct `TauriProvider.invoke()` |
| Complex AI/streaming | Delegate to `AIBridge` |
| Cross-module state | Access via `GlobalBridge` |

---

[↑ Back to Navigation](#-quick-navigation)

---

## 61. Security Deep Dive (CRITICAL)

> [!CAUTION]
> **Security violations are P0 CRITICAL issues.** Any security flaw leads to immediate PR rejection and mandatory code review.

### 61.1. Hardware-Bound Encryption (HBE)

All sensitive data MUST be encrypted using machine-specific keys.

**Algorithm:**
1. **Entropy Source A**: `machine_uid::get()` (Motherboard Serial / BIOS UUID)
2. **Entropy Source B**: Static Salt (compiled into binary)
3. **KDF**: `SHA256(Source A + SALT + Source A)` → 32-byte Key
4. **Cipher**: `AES-256-GCM` (Authenticated Encryption)
   - Nonce: Random 96-bit per write
   - Tag: 128-bit authentication tag

```rust
// src-tauri/src/services/secure_storage.rs
pub fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
    let key = derive_machine_key()?;
    let nonce = generate_random_nonce();
    
    let cipher = Aes256Gcm::new(&key);
    let ciphertext = cipher.encrypt(&nonce, plaintext)
        .map_err(|_| AppError::CryptoError("Encryption failed"))?;
    
    // Format: nonce || ciphertext (tag is appended by AES-GCM)
    Ok([nonce.as_slice(), &ciphertext].concat())
}
```

### 61.2. Memory Hygiene (Zero-Trace Policy)

**Mandatory for secrets:**

```rust
// ✅ Use zeroize for sensitive data
use zeroize::Zeroize;

struct ApiKey(String);

impl Drop for ApiKey {
    fn drop(&mut self) {
        self.0.zeroize(); // Overwrites memory with zeros
    }
}

// ✅ Secrets exist only during request lifecycle
async fn make_api_call(encrypted_key: &[u8]) -> Result<Response, AppError> {
    let key = decrypt(encrypted_key)?; // Decrypted only here
    let response = client.post(url).bearer_auth(&key).send().await?;
    // key is dropped and zeroized after this scope
    Ok(response)
}
```

**Prohibited:**
- ❌ Storing decrypted secrets in static/global variables
- ❌ Logging API keys or tokens (even partially)
- ❌ Writing secrets to temp files or swap

### 61.3. IPC Security

**Tauri Capability Allowlist:**

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "shell:allow-open",
    "window:allow-minimize",
    "window:allow-close",
    // NEVER add: "shell:allow-execute", "fs:allow-write-all"
  ]
}
```

**Command Validation:**

```rust
#[tauri::command]
pub fn save_secure_key(service: String, key: String) -> Result<(), AppError> {
    // ✅ Validate service name (prevent injection)
    if !service.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err(AppError::Validation("Invalid service name".into()));
    }
    
    // ✅ Validate key length
    if key.len() > 1024 {
        return Err(AppError::Validation("Key too long".into()));
    }
    
    secure_storage::save(&service, &key)
}
```

### 61.4. Frontend Security

**XSS Prevention Matrix:**

| Method | User Content | Safe |
|--------|--------------|------|
| `textContent` | Any | ✅ Always |
| `innerHTML` + DOMPurify | HTML | ✅ With config |
| `innerHTML` | Any | ❌ NEVER |
| `eval()` | Any | ❌ NEVER |
| `new Function()` | Any | ❌ NEVER |

```typescript
// ✅ Safe HTML rendering
import DOMPurify from 'dompurify';

const config = {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'class'],
    ALLOW_DATA_ATTR: false,
};

element.innerHTML = DOMPurify.sanitize(userHtml, config);
```

### 61.5. API Key Protection

**Lifecycle:**

```
┌─────────────────────────────────────────────────────────────┐
│                    API KEY LIFECYCLE                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   User Input ──► Frontend ──► Tauri IPC ──► Rust Backend    │
│                     │                           │            │
│                     ▼                           ▼            │
│              NEVER store             HBE Encrypt + Save     │
│              in localStorage         to secure.enc          │
│                                                              │
│   API Call: Decrypt ──► Use ──► Zeroize ──► Drop            │
│             (in RAM)    (HTTP)   (memory)   (scope end)     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 61.6. Network Security

```typescript
// ✅ HTTPS only for external APIs
const ALLOWED_SCHEMES = ['https:'];

function validateUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ALLOWED_SCHEMES.includes(parsed.protocol);
    } catch {
        return false;
    }
}

// ✅ Timeout and abort for all network requests
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
    const response = await fetch(url, { signal: controller.signal });
} finally {
    clearTimeout(timeout);
}
```

### 61.7. Security Audit Checklist

**Before every release:**

- [ ] **Secrets:** No hardcoded API keys, tokens, passwords
- [ ] **Logging:** No sensitive data in console.log/error
- [ ] **Storage:** All secrets use HBE (secure_storage.rs)
- [ ] **XSS:** All user content sanitized with DOMPurify
- [ ] **IPC:** New commands added to capabilities allowlist
- [ ] **Deps:** No known vulnerabilities (`npm audit`, `cargo audit`)
- [ ] **Memory:** Secrets zeroized after use (Rust: `zeroize` crate)
- [ ] **Network:** HTTPS-only, proper timeouts, no CORS wildcards

---

[↑ Back to Navigation](#-quick-navigation)

---

## Appendix A: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                       AXELATE QUICK REF                      │
├─────────────────────────────────────────────────────────────┤
│ NAMING                                                       │
│   Classes:     PascalCase        (AppUI, EventBus)          │
│   Functions:   camelCase         (showToast, handleClick)   │
│   Constants:   SCREAMING_SNAKE   (MAX_RETRIES, GPT_MODELS)  │
│   Private:     _prefix           (_ensureContainer)         │
│   Boolean:     is/has/should     (isValid, hasAccess)       │
│   Files:       PascalCase.ts     (EventBus.ts, AppUI.ts)    │
│   CSS:         kebab-case        (toast-container)          │
├─────────────────────────────────────────────────────────────┤
│ COMMITS                                                      │
│   feat(scope): add new feature                              │
│   fix(scope): fix bug                                       │
│   refactor(scope): restructure code                         │
│   perf(scope): improve performance                          │
│   docs(scope): update documentation                         │
├─────────────────────────────────────────────────────────────┤
│ LOGGING                                                      │
│   console.debug('[Module] Debug info');                     │
│   console.log('[Module] Info message');                     │
│   console.warn('[Module] Warning');                         │
│   console.error('[Module] Error:', err);                    │
├─────────────────────────────────────────────────────────────┤
│ CSS VARIABLES                                                │
│   Colors:   --primary, --surface, --text-primary            │
│   Spacing:  --spacing-sm, --spacing-md, --spacing-lg        │
│   Radius:   --radius-sm, --radius-md, --radius-lg           │
├─────────────────────────────────────────────────────────────┤
│ ANIMATION                                                    │
│   Micro:     100-200ms   ease-out                           │
│   UI:        200-300ms   ease-in-out                        │
│   Page:      300-500ms   cubic-bezier(0.4, 0, 0.2, 1)      │
└─────────────────────────────────────────────────────────────┘
```

---

## Appendix B: EventBus Event Catalog

### Navigation Events

| Event | Payload | Description |
|-------|---------|-------------|
| `page:change` | `{ pageId: string; previousPageId?: string }` | Page navigation |
| `page:ready` | `{ pageId: string }` | Page fully loaded |

### Module Events

| Event | Payload | Description |
|-------|---------|-------------|
| `module:download:start` | `{ moduleId: string; url: string }` | Download started |
| `module:download:progress` | `{ moduleId: string; percent: number }` | Progress update |
| `module:download:complete` | `{ moduleId: string }` | Download finished |
| `module:download:error` | `{ moduleId: string; error: string }` | Download failed |

### Window Events

| Event | Payload | Description |
|-------|---------|-------------|
| `window:minimize` | `void` | Window minimized |
| `window:maximize` | `void` | Window maximized |
| `window:close` | `void` | Window closing |
| `window:focus` | `void` | Window focused |

### Error Events

| Event | Payload | Description |
|-------|---------|-------------|
| `error:global` | `{ error: Error; context?: string }` | Unhandled error |
| `error:network` | `{ url: string; status: number }` | Network error |

---

## Appendix C: Severity Matrix

```
┌──────────────────────────────────────────────────────────────────┐
│                       ISSUE SEVERITY MATRIX                       │
├──────────────┬───────────────┬───────────────┬───────────────────┤
│   Severity   │   Response    │   Examples    │   Action          │
├──────────────┼───────────────┼───────────────┼───────────────────┤
│ P0 CRITICAL  │ < 1 hour      │ App crash     │ Hotfix + rollback │
│              │               │ Security vuln │ All hands         │
├──────────────┼───────────────┼───────────────┼───────────────────┤
│ P1 HIGH      │ < 4 hours     │ Core feature  │ Same-day fix      │
│              │               │ Memory leak   │ Priority review   │
├──────────────┼───────────────┼───────────────┼───────────────────┤
│ P2 MEDIUM    │ < 24 hours    │ Non-critical  │ Next sprint       │
│              │               │ Performance   │                   │
├──────────────┼───────────────┼───────────────┼───────────────────┤
│ P3 LOW       │ < 1 week      │ UI glitch     │ Backlog           │
│              │               │ Edge case     │                   │
└──────────────┴───────────────┴───────────────┴───────────────────┘
```

---

**Violation of any of these points is grounds for Pull Request rejection.**

---

*Document updated: 2026-01-30*  
*Version: 2.6.0*  
*Maintainer: Axelate Team*  
*Total Sections: 61 + 3 Appendices*
