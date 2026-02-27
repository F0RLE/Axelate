# File Tree & Architecture: Axelate

This document serves as the single source of truth for the project's folder structure. Every file and directory is accompanied by its direct architectural responsibility, strictly adhering to our KISS and SOLID principles.

```text
├── 📁 .github                      # Automation, GitHub Actions, and environment scripts
│   ├── 📁 .husky                   # Git hooks. Ensures code passes linting/formatting before commit (`pre-commit`) and verifies commit message formatting (`commit-msg`)
│   ├── 📁 ISSUE_TEMPLATE           # Standardized templates for bug reports and feature requests
│   ├── 📁 scripts                  # Standalone build & CI/CD pipeline scripts
│   │   ├── 📄 clear.ps1            # Deep cleaning utility. Removes build artifacts, caches, and node_modules
│   │   ├── 📄 common.ps1           # Shared environment variables, paths, and core helper functions for all PS1 scripts
│   │   ├── 📄 dev.ps1              # Local environment orchestrator. Runs auto-format, dependency install, and `tauri dev`
│   │   ├── 📄 release.ps1          # Triggers strict CI checks and builds the production executable (App release)
│   │   ├── 📄 update.ps1           # Updates Node & Cargo dependencies, then verifies build stability
│   │   └── 📄 verify-all.ps1       # Mimics strict CI checks locally (clippy, Tsc typecheck, eslint, Vitest)
│   ├── 📁 workflows                # CI/CD pipelines executed on GitHub servers
│   │   ├── ⚙️ ci.yml                 # Main automated testing & linting matrix on pushes/PRs
│   │   └── ⚙️ release.yml            # Automated GitHub Release generation matrix
│   ├── 📝 CODE_OF_CONDUCT.md       # Open Source code of conduct policy
│   ├── 📝 CONTRIBUTING.md          # Guidelines on how to contribute code and architecture
│   ├── 📝 PULL_REQUEST_TEMPLATE.md # Standard PR description template
│   ├── 📝 SECURITY.md              # Vulnerability reporting protocol
│   ├── 📄 commitlint.config.js     # Configures commit message conventions (Conventional Commits)
│   └── ⚙️ dependabot.yml           # Configuration for automated dependency updates via Dependabot
├── 📁 docs                         # Internal Project Documentation
│   ├── 📁 en                       # Documentation (English)
│   │   ├── 📝 AUTOMATION.md        # Guide on CI/CD pipelines and the `.github/scripts/` automation
│   │   ├── 📝 CODING_STANDARDS.md  # Core principles, design patterns, and engineering rules (KISS, YAGNI, SOLID)
│   │   ├── 📝 FileTree.md          # THIS FILE. Detailed structural map and file accountability
│   │   ├── 📝 architecture.md      # High-level architecture overview (Tauri, Rust Backend, Vanilla TS Frontend)
│   │   └── 📝 getting-started.md   # Developer onboarding guide
│   ├── 📁 ru                       # Documentation (Russian)
│   │   ├── 📝 ROADMAP.md           # Visualizes future features and goals
│   │   └── 📝 VISION.md            # High-level manifesto and product vision
│   └── 📁 zh                       # Documentation (Chinese)
│       └── 📝 README_CN.md         # Localized Chinese README
├── 📁 src                          # 🌐 Frontend Application (Vanilla TypeScript, No Frameworks, strictly OOP/Module based)
│   ├── 📁 app                      # Application Bootstrapping & Core Initialization
│   │   ├── 📄 bridge.ts            # Exposes core services to `globalThis` (window). Wires `axelateAPI`, fetch interceptor for chat IPC, and all legacy global functions (`showPage`, `selectApp`, `launchApp`, etc.)
│   │   ├── 📄 events.ts            # Centralized DOM event handler using delegation. Wires all click events for navigation, window controls, language switcher, chat buttons, download settings, and feature modals
│   │   ├── 📄 init.ts              # DI root / composition root. Constructs and wires all services and UI classes, drives the async bootstrap sequence (splash, state load, i18n, page render)
│   │   └── 📄 router.ts            # Re-exports `NavigationService.getInstance()` as `router` for convenient import
│   ├── 📁 assets                   # Static assets for the frontend
│   │   ├── 📁 fonts                # Bundled, local webfonts (Cubic_11.woff2, Monocraft.woff2)
│   │   ├── 📄 icons.ts             # Contains raw SVG strings exported as constant variables for UI usage without HTTP requests
│   │   └── 📄 logos.ts             # SVG strings for brand logos (Axelate branding)
│   ├── 📁 features                 # 🔥 Core Business Logic (Feature-Based Architecture). Each folder is an isolated domain.
│   │   ├── 📁 ai                   # Artificial Intelligence features (LLM providers, generation settings)
│   │   │   ├── 📁 providers        # AI provider contracts
│   │   │   │   └── 📄 AIProvider.ts    # `IAIProvider` interface: `initialize`, `validateKey`, `sendMessage`, `getAvailableModels`, `dispose`
│   │   │   ├── 📁 services         # AI orchestration and transport
│   │   │   │   ├── 📄 AIBridge.ts      # Singleton: manages provider sessions, routes `sendMessage` through transport, broadcasts chunks/thoughts to subscribers
│   │   │   │   ├── 📄 AIChatTransport.ts # `IChatTransport` impl: invokes `send_chat_message` via Tauri IPC, listens `ai:chat:chunk` / `ai:thought:chunk` events
│   │   │   │   └── 📄 AIProviderManager.ts # Tracks active provider/API key/model/session, reads keys from secure storage, resolves model from catalog
│   │   │   ├── 📁 types            # AI-specific TypeScript types
│   │   │   │   ├── 📄 IAIBridge.ts         # Core AI bridge contract interface
│   │   │   │   └── 📄 aiTypes.ts            # `IChatMessage`, `IBridgeResponse`, `MessageHandler`, `IChunkHandler`, `MessageSource`
│   │   │   ├── 📁 ui               # AI settings DOM rendering
│   │   │   │   └── 📄 AISettingsRenderer.ts # Renders forms for AI API Keys, model selection, and system prompt
│   │   │   ├── 📁 utils            # AI-specific helper functions
│   │   │   │   ├── 📄 catalogHelpers.ts    # `getModelData`, `getMostPowerfulModel` — reads model metadata from catalog
│   │   │   │   └── 📄 chatRequestUtils.ts  # Builds `IChatRequest` payload from message text, history, and attachments
│   │   │   └── 📄 index.ts         # Feature public API export
│   │   ├── 📁 chat                 # Main Chat Interface Feature
│   │   │   ├── 📁 controllers      # Binds UI to logical action handlers
│   │   │   │   ├── 📄 FilePickerController.ts # `pick()` (native `open` + web fallback), `handleFileSelect`, `updateTokenCount`
│   │   │   │   └── 📄 VoiceController.ts # `toggle()`/`stop()` voice dictation; delegates to `VoiceInputService`
│   │   │   ├── 📁 services         # Logic for handling communication
│   │   │   │   ├── 📄 ChatFileHandler.ts   # State manager for attachments; `processForSend()` routes to `_processWithBackend` or `_processWithWebFallback`
│   │   │   │   ├── 📄 ChatService.ts       # Validates input, sends messages through `IAIBridge` to the active AI provider
│   │   │   │   └── 📄 VoiceInputService.ts # Uses `webkitSpeechRecognition`, maps BCP-47 (`ru-RU`, `zh-CN`, `en-US`), handles continuous recording stream
│   │   │   ├── 📁 types            # Chat-specific models
│   │   │   │   └── 📄 chatTypes.ts         # IChatMessage, IChatResponse, Role types
│   │   │   ├── 📁 ui               # Renders the chat view: message bubbles, streaming, attachments
│   │   │   │   └── 📄 ChatUI.ts        # Renders markdown (`marked`, `DOMPurify`), streams chunks (`createStreamingMessage`), handles file previews + token limits
│   │   │   ├── 📁 utils            # Token estimation and markdown stream buffer helpers
│   │   │   │   └── 📄 chatUtils.ts         # Token count estimator and markdown content accumulator
│   │   │   ├── 📄 chat.ts          # ChatController: DI root for the chat feature, wires services and UI, binds DOM events
│   │   │   └── 📄 index.ts         # Feature public API export
│   │   ├── 📁 dashboard            # Main application landing page
│   │   │   ├── 📁 ui               # Renders the initial hub layout
│   │   │   │   └── 📄 DashboardUI.ts  # Placeholder Dashboard UI component (`init`, `destroy`)
│   │   │   └── 📄 index.ts         # Feature public API export
│   │   ├── 📁 debug                # Developer debug UI and log services
│   │   │   ├── 📁 services         # Log processing and backend fetching
│   │   │   │   └── 📄 DebugService.ts  # `fetchLogs()`, `clearLogs()`, `processLogs()` filters noisy/bot errors (Gemini/429/500/etc.) from `ILogEntry[]`
│   │   │   ├── 📁 ui               # Renders raw log output and developer diagnostics
│   │   │   │   └── 📄 DebugUI.ts       # Binds draggable overlay, dropzone, tabs (`setTab`), log polling (`startLogPolling`), JSON parsing (`safeJsonParse`)
│   │   │   └── 📄 index.ts         # Feature public API export
│   │   ├── 📁 downloads            # Local AI model package downloading feature
│   │   │   ├── 📁 types            # Download-specific interfaces
│   │   │   │   └── 📄 downloaderTypes.ts  # Downloader types (`DownloadProgress`, `DownloadSettings`)
│   │   │   ├── 📁 ui               # Download list UI with progress bars and settings modal
│   │   │   │   └── 📄 DownloadUI.ts    # Manages `DownloadProgress` UI, `updateSpeedDisplay`, ETA calculations (`_updateEta`), EWMA speed tracking (`_ema`), UI layout
│   │   │   └── 📄 index.ts         # Feature public API export
│   │   ├── 📁 monitoring           # System hardware monitoring (CPU, RAM, GPU)
│   │   │   ├── 📁 services         # Bridges Tauri backend for hardware telemetry
│   │   │   │   └── 📄 MonitoringService.ts # `startMonitoring()` uses Tauri event `system_stats`, unlistens on unmount, pauses monitoring on document `visibilitychange`, fallbacks to API polling `setInterval`
│   │   │   ├── 📁 types            # System metrics models
│   │   │   │   └── 📄 monitoringTypes.ts   # Interfaces for CPU/RAM/GPU load and memory usage payloads
│   │   │   ├── 📁 ui               # Renders hardware load graphs in the monitoring panel
│   │   │   │   └── 📄 MonitoringUI.ts  # Renders `requestAnimationFrame` tweens (`_animateMainValue`), EWMA smoothing (`_ema`), formats byte/network speeds, updates hardware progress bars
│   │   │   └── 📄 index.ts         # Feature public API export
│   │   └── 📁 settings             # Global application configuration manager
│   │       ├── 📁 services         # Saves/loads user preferences
│   │       │   └── 📄 SettingsService.ts # Reads/writes `ISettings` (`AppSettings`), `loadGpuInfo()`, `getModules()`, secure API key storage (`saveSecureKey`/`getSecureKey`), `validateApiKey()`, `addCustomModel()`
│   │       ├── 📁 ui               # UI rendering for the settings modal
│   │       │   ├── 📁 components       # Reusable form field widgets for settings panels
│   │       │   │   ├── 📄 CardResizer.ts      # Handles collapsible settings card expand/collapse
│   │       │   │   ├── 📄 FieldFactory.ts     # Factory creating the correct field widget by type
│   │       │   │   ├── 📄 ISettingField.ts    # Interface contract all setting field widgets must implement
│   │       │   │   ├── 📄 NumberField.ts      # Numeric input field widget
│   │       │   │   ├── 📄 SelectField.ts      # Dropdown select field widget
│   │       │   │   ├── 📄 TextField.ts        # Text input field widget
│   │       │   │   └── 📄 ToggleField.ts      # Boolean toggle field widget
│   │       │   ├── 📄 GeneralSettingsRenderer.ts # Specialized renderer for toggling sidebar (`toggleNavItem`) and monitor visibility (`toggleMonitorItem`), monitors `ResizeObserver` for compact layouts
│   │       │   ├── 📄 SettingsContext.ts         # `ISettingsUIContext` definition
│   │       │   └── 📄 SettingsUI.ts              # Main orchestrator, `addCustomModelToSettings()`, `checkModuleKey()`, `_renderSpecializedModuleConfig()` (gpt, gemini, claude, axelate)
│   │       └── 📄 index.ts         # Feature public API export
│   ├── 📁 infrastructure           # Core application infrastructural services (Dependencies for Features)
│   │   ├── 📁 i18n                 # Internationalization logic
│   │   │   ├── 📄 I18nService.ts     # Detects system language via `get_system_language` IPC, fetches JSON translations via `get_translations`, interpolates `t(key, default, params)`, syncs lang to backend settings
│   │   │   └── 📄 I18nUI.ts          # Walks DOM applying `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label`; updates flag icon, language menu, `toggleMenu`, `setLanguage`
│   │   ├── 📁 logging              # Universal frontend logger
│   │   │   └── 📄 LoggerService.ts   # Intercepts `console.error`/`warn`, buffers `ILogEntry[]` (max 10), flushes to Tauri backend every 500ms, redacts sensitive keys, renders on-screen debug overlay
│   │   ├── 📁 navigation           # App-level page/history routing
│   │   │   ├── 📄 NavigationService.ts # Singleton: `navigate(pageId)`, `goBack/Forward()`, back/forward action stacks (for modals/dropdowns), persists last page via `UISettingsService`
│   │   │   └── 📄 NavigationUI.ts    # Binds `[data-page]` buttons, mouse buttons 3/4, Escape key; calls `showPage()` which hides all `.page` elements and activates the target
│   │   └── 📁 tauri                # Tauri IPC integration
│   │       └── 📄 TauriProvider.ts   # `IBridge` implementation: `invoke()` with v2 API + `__TAURI__` fallback, `listen()` for events, `getSecureKey`/`saveSecureKey`, `_mockInvoke` for dev/test
│   ├── 📁 public                   # Pure static HTML payloads (loaded into JS memory at runtime via XHR/Fetch)
│   │   └── 📁 templates            # HTML Fragments representing base structures
│   │       ├── 📁 components       # sidebar.html components
│   │       └── 📁 pages            # settings.html structural boilerplate
│   ├── 📁 scripts                  # Standalone NodeJS tooling scripts for frontend build steps
│   │   ├── 📄 analyze-lint-v2.cjs  # Custom AST analyzer for deep linting
│   │   ├── 📄 bump-version.js      # Utility updating version strings in cargo.toml and package.json synchronously
│   │   ├── 📄 check-size.js        # CI utility validating compiled frontend JS size limitations
│   │   └── 📄 convert-font.js      # Utility converting TTF -> WOFF2 for optimized webfont generation
│   ├── 📁 shared                   # Globally shared utilities, components, and types used across multiple features
│   │   ├── 📁 api                  # Typed Tauri IPC layer
│   │   │   ├── 📄 invoke.ts         # `invokeSafe<T>()` — type-safe wrapper around Tauri `invoke`, returns `Result<T>`
│   │   │   └── 📄 types.ts          # `Result<T, E>`, `AppError` types and `isOk`/`isError` guards
│   │   ├── 📁 components           # Shared high-level DOM orchestrators
│   │   │   ├── 📁 ui               # Utility DOM managers (modals, skeletons, toasts, module cards)
│   │   │   │   ├── 📄 ModalManager.ts         # Opens/closes and animates modal dialogs
│   │   │   │   ├── 📄 ModuleCardRenderer.ts   # Renders module cards in the app selection UI
│   │   │   │   ├── 📄 SkeletonManager.ts      # Shows/hides skeleton loading placeholders
│   │   │   │   └── 📄 ToastManager.ts         # Renders and auto-dismisses toast notifications
│   │   │   ├── 📄 AppUI.ts         # Facade for `ModalManager`, `SkeletonManager`, `ToastManager`, `ModuleCardRenderer`: handles module card selection, toast display, app-selection modal
│   │   │   ├── 📄 Particles.ts     # Canvas `requestAnimationFrame` particle animation: spawns, moves, and draws colored particles; respects `prefers-reduced-motion`
│   │   │   ├── 📄 SidebarUI.ts     # Collapse/expand sidebar with snapping timeout; restores collapsed state from `UISettingsService`; hides system monitor if too little vertical space
│   │   │   └── 📄 WindowUI.ts      # Binds global keyboard shortcuts, debounced resize, small-screen protection, text-selection prevention, sound toggle, `hideSplashScreen()`
│   │   ├── 📁 config               # Static application constants
│   │   │   └── 📄 catalog_fallback.ts # `FALLBACK_CONFIG`: empty `AppConfig` used when backend catalog fetch fails
│   │   ├── 📁 services             # Cross-feature logical singletons
│   │   │   ├── 📁 ai                 # AI-specific settings state slice
│   │   │   │   └── 📄 AISettingsService.ts   # Reads/writes AI provider selection from UiStateStore
│   │   │   ├── 📁 downloads          # Download-specific settings state slice
│   │   │   │   └── 📄 DownloadSettingsService.ts # Reads/writes download speed limits from UiStateStore
│   │   │   ├── 📁 modules            # Module selection state slice
│   │   │   │   └── 📄 ModuleSettingsService.ts   # Reads/writes selected module per category from UiStateStore
│   │   │   ├── 📁 state              # Reactive UI state store
│   │   │   │   └── 📄 UiStateStore.ts        # Top-level reactive state repository. Loads/saves UI state via TauriProvider
│   │   │   ├── 📁 ui                 # UI-specific settings state slice
│   │   │   │   └── 📄 UISettingsService.ts   # Reads/writes zoom level, sidebar state, and UI preferences from UiStateStore
│   │   │   ├── 📄 CatalogService.ts       # Loads `AppConfig` + installed modules via Tauri IPC, merges schemas, hydrates `ICatalogData`; exposes `getAppById`, `getCatalog`
│   │   │   ├── 📄 ErrorHandler.ts         # Registers `window.onerror` + `onunhandledrejection`; captures errors to `IErrorInfo` log (max 100), emits `error:global` on `eventBus`, shows toast
│   │   │   ├── 📄 EventBus.ts             # Typed pub/sub: `on`, `once`, `off`, `emit`, `clear`; `IEventBusEvents` map covers navigation, modules, window, i18n, errors, app selection
│   │   │   ├── 📄 ModulePlatformService.ts # Facade abstracting download/delete/stop for both local and API-based modules
│   │   │   ├── 📄 ModuleService.ts        # Manages local module lifecycle: install, delete, control, status polling
│   │   │   ├── 📄 SoundService.ts         # `AudioContext`-based UI sounds: `playHover` (blip), `playClick` (muffled), `playToggle`, `playExpand`; binds mouse events globally
│   │   │   ├── 📄 TemplateLoader.ts       # Fetches `*.html` from `/templates/` via fetch, caches in-memory, DOMPurify-sanitizes on inject; `loadAndInject`, `appendTemplate`, `preloadTemplates`
│   │   │   └── 📄 WindowService.ts        # Manages zoom, minimize/maximize/close, tray, resize, and resolution change events
│   │   ├── 📁 types                # Global TypeScript type definitions
│   │   │   ├── 📄 IBridge.ts            # `IBridge` interface: `invoke()`, `listen()`, `isTauri()` — IPC contract
│   │   │   ├── 📄 bindings.ts           # Auto-generated Specta types mirroring all Rust structs to TypeScript (do not edit)
│   │   │   ├── 📄 categoryKeys.ts       # `CategoryKey` const enum: `'ai'`, `'ai_text'`, `'ai_image'`, `'services'`
│   │   │   ├── 📄 coreTypes.ts          # `IApp`, `IBootstrapData`, `ILogEntry`, `IModuleDownloadState`, `ITauriInstance`, etc.
│   │   │   ├── 📄 global.d.ts           # Global `Window` augmentations: `axelateAPI`, `__TAURI__`, `t()`, `core`, etc.
│   │   │   └── 📄 global_bridge_types.ts # `IGlobalBridge`, `TGlobalWin`, typed function aliases for all global bridge fns
│   │   ├── 📁 ui                   # Reusable base UI primitives
│   │   │   ├── 📁 components       # Concrete base widgets
│   │   │   │   ├── 📄 ActionButton.ts   # Button wrapper with loading state, disabled on click, click handler via `BaseComponent`
│   │   │   │   └── 📄 AsyncView.ts      # Abstract generic view: `fetchData()` → `renderLoading/Error/Ready()` with DOMPurify
│   │   │   ├── 📄 BaseComponent.ts      # Abstract lifecycle class: `init()`, `destroy()`, `getElement()`, `AbortController` cleanup
│   │   │   └── 📄 renderSimpleFeature.ts # Renders a DOMPurify-sanitized `<h1>` placeholder for stub feature pages
│   │   └── 📁 utils                # Cross-cutting utilities
│   │       └── 📄 globalAccessor.ts     # `getGlobalWin()`: returns `window` cast to `TGlobalWin` for type-safe global access
│   ├── 📁 styles                   # Global Vanilla CSS architecture
│   │   ├── 📁 base                 # Global variables, reset logic, animations, scrollbars
│   │   ├── 📁 components           # Reusable functional blocks (buttons, inputs, cards, status badges)
│   │   ├── 📁 features             # Component styles grouped by primary feature domains
│   │   ├── 📁 layouts              # Structural page layouts (Sidebar, modals, main content area constraints)
│   │   ├── 📁 tokens               # CSS custom properties reservation and design system declarations
│   │   └── 🎨 main.css             # Main stylesheet orchestrating all @import statements sequentially
│   ├── 📁 test                     # Vitest configuration and base setup fixtures
│   ├── ⚙️ .prettierignore          # Files to exclude from Prettier formatting
│   ├── ⚙️ .prettierrc              # Strict formatting rules enforcing uniform codestyle
│   ├── 📄 eslint.config.js         # Maximum strictness TS linting configuration preventing TS `any` and bad practices
│   ├── 🌐 index.html               # Main frontend entry point (SPA hub), holds `#app` mount point
│   ├── ⚙️ package.json             # Frontend dependency declaration and script executor
│   ├── 📄 package-lock.json        # Deterministic frontend dependency tree lockfile
│   ├── ⚙️ tsconfig.json            # TypeScript build configuration rules mapping paths and typing strictness
│   ├── 📄 vite-env.d.ts            # Vite client type declarations and static asset types
│   └── 📄 vite.config.ts           # Vite JS bundling logic, optimizations, and hot-reload plugins
├── 📁 src-tauri                    # 🦀 Rust Backend (The native layer driving low-level capabilities)
│   ├── 📁 capabilities             # Security restrictions defining exactly what Tauri APIs the frontend can access
│   ├── 📁 icons                    # Compiled application shortcut and taskbar tray icons (.ico, .png, .svg)
│   ├── 📁 resources                # Bundled backend assets installed directly with the Application payload
│   │   ├── 📁 config               # Default configurations for local variables and generic UI states
│   │   ├── 📁 locales              # Main internationalization repository natively (en.json, ru.json, zh.json)
│   │   └── ⚙️ api_providers.json      # Hardcoded configuration models instructing how to route to different AI APIs
│   ├── 📁 src                      # Rust source code execution logic
│   │   ├── 📁 api                  # Tauri Commands (RPC Endpoints). Thin adapters returning `Result<T, E>` to frontend
│   │   │   ├── 📁 ai               # `send_chat_message`, `validate_api_key`, `clear_chat_history`, `get_chat_history`, `count_tokens`
│   │   │   ├── 📁 license          # `get_license_status`, `activate_license`, `deactivate_license`, `check_feature`
│   │   │   ├── 📁 modules          # `get_modules`, `get_module_status`, `launch_module`, `control_module`, and `downloader` commands
│   │   │   ├── 📁 secure           # `save_secure_key`, `get_secure_key`
│   │   │   ├── 📁 settings         # `get_settings`, `save_settings`, `save_setting`, `get_system_language` + submodules
│   │   │   ├── 📁 system           # `get_system_stats`, `get_gpu_info`, `set_monitoring_paused` + `logs`/`bootstrap` submodules
│   │   │   ├── 📁 window           # `minimize_window`, `maximize_window`, `close_window`, `show_window`, `hide_window`
│   │   │   └── 🦀 mod.rs           # Registers all API command modules
│   │   ├── 📁 app                  # Tauri startup lifecycle hooks and taskbar config
│   │   │   ├── 🦀 mod.rs           # App module root
│   │   │   ├── 🦀 tray.rs          # System tray menu setup and click handlers
│   │   │   └── 🦀 window.rs        # Initial window configuration: size, decorations, centering
│   │   ├── 📁 bin                  # Additional binary targets compiled alongside the main app
│   │   │   └── 🦀 exporter.rs      # Standalone binary for Specta type export generation
│   │   ├── 📁 domain               # 🧠 Core Business Logic, untied from Tauri endpoints
│   │   │   ├── 📁 ai               # LLM request orchestration, streaming, session management
│   │   │   │   ├── 🦀 ai_service.rs          # Core AI generation: routes prompts to providers, streams response chunks
│   │   │   │   ├── 🦀 custom_model_service.rs# CRUD for user-defined custom AI model entries
│   │   │   │   ├── 🦀 session.rs             # Chat history persistence: save/load conversation turns
│   │   │   │   ├── 🦀 streaming.rs           # SSE/chunked stream decoder, assembles token deltas into text
│   │   │   │   └── 🦀 types.rs               # Domain types: `AiRequest`, `AiResponse`, `StreamChunk`
│   │   │   ├── 📁 filesystem       # App-specific path resolution and safe file access
│   │   │   │   └── 🦀 service.rs             # Resolves app data paths; safe file read/write scoped to app dirs
│   │   │   ├── 📁 license         # License key verification domain logic
│   │   │   │   ├── 🦀 storage.rs             # Reads/writes license key from secure storage
│   │   │   │   ├── 🦀 types.rs               # `LicenseKey`, `VerificationResult` domain types
│   │   │   │   └── 🦀 verifier.rs            # Cryptographic license key validation logic
│   │   │   ├── 📁 modules         # Native process lifecycle: download, spawn, kill, status
│   │   │   │   ├── 🦀 downloader.rs          # Downloads binary payloads, verifies SHA-256, extracts archives
│   │   │   │   └── 🦀 lifecycle.rs           # Spawns, monitors, and kills module child processes
│   │   │   ├── 📁 monitoring      # Hardware telemetry polling
│   │   │   │   ├── 🦀 gpu_collector.rs       # Queries GPU load/VRAM via WMI on Windows
│   │   │   │   ├── 🦀 health.rs              # Aggregates CPU/RAM/GPU into a system health snapshot
│   │   │   │   └── 🦀 system_monitor.rs      # Polling loop: emits hardware metrics to frontend via Tauri events
│   │   │   └── 📁 system          # OS config and startup orchestration
│   │   │       ├── 🦀 config_repository.rs   # Loads `AppConfig` from disk on startup
│   │   │       ├── 🦀 config_service.rs      # Business logic for reading and mutating app configuration
│   │   │       └── 🦀 startup.rs             # Orchestrates startup checks: config load, module scan, state init
│   │   ├── 📁 infrastructure       # External world integration (Disk I/O, Network, Cryptography)
│   │   │   ├── 📁 config           # AppData configuration persistence
│   │   │   │   ├── 🦀 config_repository.rs   # Reads/writes `AppConfig` JSON from AppData
│   │   │   │   ├── 🦀 settings.rs            # Persists user settings (language, theme, sound, etc.)
│   │   │   │   ├── 🦀 theme.rs               # Loads/saves selected UI theme
│   │   │   │   ├── 🦀 translations.rs        # Reads JSON locale files from bundled resources
│   │   │   │   ├── 🦀 ui_state.rs            # Persists and restores UI state (sidebar, zoom, etc.)
│   │   │   │   └── 🦀 window_settings.rs     # Saves/loads window position, size across sessions
│   │   │   ├── 📁 crypto           # OS credential store integration
│   │   │   │   └── 🦀 secure_storage.rs      # Read/write secrets via Windows Credential Manager / Keychain
│   │   │   ├── 📁 filesystem       # Generic file I/O operations
│   │   │   │   ├── 🦀 file_service.rs        # Abstract file read/write/delete interface
│   │   │   │   └── 🦀 local_file_service.rs  # Concrete implementation using `std::fs` with path validation
│   │   │   ├── 📁 http             # Native HTTP client bypassing WebView CORS
│   │   │   │   └── 🦀 server.rs              # Axum local HTTP server for streaming SSE chunks to the frontend
│   │   │   ├── 📁 logging          # Persistent log file management
│   │   │   │   └── 🦀 logger.rs              # Initializes `tracing` subscriber, writes to rotating log file in AppData
│   │   │   ├── 📁 persistence      # JSON key-value store
│   │   │   │   └── 🦀 json_store.rs          # Generic `JsonStore<T>`: typed get/set/save for any serializable value
│   │   │   └── 📁 system           # OS process/ background startup
│   │   │       └── 🦀 startup.rs             # Spawns background OS processes required at app start
│   │   ├── 📁 models               # Data structures mapped via Specta. Defines the strict shape of the data flow.
│   │   │   ├── 🦀 config.rs        # App configuration state (language, theme, paths)
│   │   │   ├── 🦀 custom_models.rs # User-defined custom AI model configurations
│   │   │   ├── 🦀 license.rs       # License key and validation status representations
│   │   │   ├── 🦀 mod.rs           # Models module root
│   │   │   ├── 🦀 module.rs        # Single module process tracking data payload
│   │   │   ├── 🦀 modules.rs       # Module list and status aggregation structures
│   │   │   ├── 🦀 settings.rs      # Persisted user settings shape (zoom, sound, etc.)
│   │   │   ├── 🦀 system.rs        # OS hardware info and system metadata structures
│   │   │   └── 🦀 ui_state.rs      # UI state snapshot bound to Specta-generated frontend types
│   │   ├── 📁 utils                # Rust-specific helper modules
│   │   │   ├── 🦀 memory.rs        # Memory usage helpers (bytes formatter)
│   │   │   ├── 🦀 mod.rs           # Utils module root
│   │   │   ├── 🦀 paths.rs         # App data path resolution for config, logs, and module binaries
│   │   │   ├── 🦀 process.rs       # Process kill and PID utility helpers
│   │   │   └── 🦀 windows.rs       # Windows-specific API helpers (DPI, registry, process list)
│   │   ├── 🦀 errors.rs            # Core custom Error handling with mapped OS code tracking (Anyhow/Thiserror wrappers)
│   │   ├── 🦀 lib.rs               # Library export hub. Generates Specta TS exact typings automatically via `builder()`
│   │   ├── 🦀 main.rs              # Rust Entry Point. Executes Tauri Builder strictly passing capabilities
│   │   └── 🦀 tests.rs             # Core logic integration tests ensuring Tauri API mapping consistency locally
│   ├── 📄 Cargo.lock               # Deterministic dependency resolution for all Rust external packages mapping
│   ├── ⚙️ Cargo.toml               # Rust dependencies definitions, features, workspace architecture metadata
│   ├── 🦀 build.rs                 # Cargo build script setting up Tauri Windows resource headers prior to compilation
│   ├── ⚙️ rustfmt.toml             # Absolute strict formatting for backend rust files enforcing one exact C-style
│   └── ⚙️ tauri.conf.json          # Core Tauri application configurator (Window size, app name: Axelate, Bundle IDs)
├── ⚙️ .editorconfig                # Universal IDE text settings synchronizer (Tabs, spacing, UTF-8 standardizations)
├── ⚙️ .gitattributes               # Defines how git handles EOL characters cross-platform automatically (avoids CRLF issues)
├── ⚙️ .gitignore                   # Directories ignored by source control completely (Build Artifacts, native binaries, local logs)
├── 📄 LICENSE                      # Project Open Source Licensing declaration text
├── 📝 README.md                    # Public GitHub Repository presentation markdown explaining project goals
└── ⚙️ package.json                 # Core Root dependency declaration (Husky, Commitlint proxied configurations)
```

**Key Architectural Takeaways:**
1. Strictly decoupled: Frontend logic NEVER accesses backend implementations directly. All operations pass through `src/shared/api` invoking strictly typed `src-tauri/src/api` Tauri endpoints.
2. Rust `Domain` independence: Business logic (`infrastructure/` & `domain/`) is 100% agnostic to Tauri. It can be easily rewritten to a native UI cleanly.
3. Feature folders: Instead of spreading types, logic, and UI globally across `components/`, everything relies on isolated domains (`features/ai`, `features/monitoring`).