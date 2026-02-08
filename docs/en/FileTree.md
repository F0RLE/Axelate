# File Tree: Axelate

> **Architecture:** Vertical Slice + Clean Architecture
> **Last Updated:** 2026-02-08

```
├── 📁 .github
│   ├── 📁 .husky
│   │   ├── 📄 commit-msg # Commit message hook
│   │   └── 📄 pre-commit # Pre-commit hook
│   ├── 📁 ISSUE_TEMPLATE
│   │   ├── 📝 bug_report.md
│   │   └── 📝 feature_request.md
│   ├── 📁 scripts
│   │   ├── 📄 clear.ps1 # Script to clear build artifacts
│   │   ├── 📄 dev.ps1 # Development environment startup script
│   │   ├── 📄 release.ps1 # Release build script
│   │   ├── 📄 update.ps1 # Project update script
│   │   └── 📄 verify-all.ps1 # Comprehensive project verification script
│   ├── 📁 workflows
│   │   ├── ⚙️ ci.yml # Continuous Integration workflow
│   │   └── ⚙️ release.yml # Release build workflow
│   ├── 📝 PULL_REQUEST_TEMPLATE.md
│   ├── 📄 commitlint.config.js # CommitLint configuration
│   └── ⚙️ dependabot.yml # Dependabot configuration
├── 📁 docs
│   ├── 📁 en
│   │   ├── 📝 CODING_STANDARDS.md
│   │   ├── 📝 FileTree.md
│   │   ├── 📝 architecture.md
│   │   └── 📝 getting-started.md
│   └── 📝 VISION.md
├── 📁 src
│   ├── 📁 assets
│   │   ├── 📁 fonts
│   │   │   ├── 📄 Cubic_11.ttf
│   │   │   └── 📄 Monocraft.otf
│   │   ├── 📄 icons.ts
│   │   └── 📄 logos.ts
│   ├── 📁 css
│   │   ├── 📁 base
│   │   │   ├── 🎨 animations.css
│   │   │   ├── 🎨 reset.css
│   │   │   ├── 🎨 scrollbar.css
│   │   │   └── 🎨 variables.css
│   │   ├── 📁 components
│   │   │   ├── 🎨 buttons.css
│   │   │   ├── 🎨 cards.css
│   │   │   ├── 🎨 forms.css
│   │   │   ├── 🎨 icons.css
│   │   │   └── 🎨 status.css
│   │   ├── 📁 layout
│   │   │   ├── 🎨 controls.css
│   │   │   ├── 🎨 main-area.css
│   │   │   ├── 🎨 modals.css
│   │   │   ├── 🎨 sidebar.css
│   │   │   ├── 🎨 splash.css
│   │   │   └── 🎨 toasts.css
│   │   ├── 📁 modules
│   │   │   ├── 🎨 ai-settings.css
│   │   │   ├── 🎨 chat.css
│   │   │   ├── 🎨 dashboard.css
│   │   │   ├── 🎨 debug.css
│   │   │   ├── 🎨 downloads.css
│   │   │   ├── 🎨 monitoring.css
│   │   │   └── 🎨 settings.css
│   │   └── 🎨 main.css
│   ├── 📁 modules
│   │   ├── 📁 ai
│   │   │   ├── 📁 providers
│   │   │   │   └── 📄 AIProvider.ts # Abstract base class for AI providers
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 aiTypes.ts # Type definitions for AI models and responses
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 AISettingsRenderer.ts # Renders AI-specific settings UI
│   │   │   ├── 📁 utils
│   │   │   │   └── 📄 catalogHelpers.ts # Helpers for AI model catalog operations
│   │   │   ├── 📄 AIBridge.ts # Bridge for AI operations (legacy support)
│   │   │   └── 📄 index.ts # Module entry point
│   │   ├── 📁 chat
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 ChatFileHandler.ts # Handles file attachments in chat
│   │   │   │   ├── 📄 ChatService.ts # Core chat logic and state management
│   │   │   │   └── 📄 VoiceInputService.ts # Handles voice input/STT
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 chatTypes.ts # Chat-related type definitions
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 ChatUI.ts # Chat interface renderer and interaction handler
│   │   │   ├── 📁 utils
│   │   │   │   └── 📄 chatUtils.ts # Utility functions for chat formatting
│   │   │   ├── 📄 chat.ts # Chat module initialization (legacy)
│   │   │   └── 📄 index.ts # Module entry point
│   │   ├── 📁 core
│   │   │   ├── 📁 boot
│   │   │   │   ├── 📄 EventHandler.ts # Central event handling logic
│   │   │   │   └── 📄 GlobalBridge.ts # Exposes core services to global window object
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 CatalogService.ts # Manages app catalog and configuration
│   │   │   │   ├── 📄 ErrorHandler.ts # Global error handling service
│   │   │   │   ├── 📄 EventBus.ts # Pub/Sub event bus implementation
│   │   │   │   ├── 📄 I18nService.ts # Internationalization and translation service
│   │   │   │   ├── 📄 LoggerService.ts # Application logging service
│   │   │   │   ├── 📄 ModuleService.ts # Manages module downloads and lifecycle
│   │   │   │   ├── 📄 NavigationService.ts # handles page navigation
│   │   │   │   ├── 📄 SoundService.ts # UI sound effects manager
│   │   │   │   ├── 📄 StateService.ts # Manages global application state
│   │   │   │   ├── 📄 TauriProvider.ts # Bridge to Tauri backend commands
│   │   │   │   ├── 📄 TemplateLoader.ts # Loads HTML templates for UI
│   │   │   │   └── 📄 WindowService.ts # Window management (maximize, minimize, etc.)
│   │   │   ├── 📁 types
│   │   │   │   ├── 📄 bindings.ts # TypeScript bindings for Rust structs
│   │   │   │   ├── 📄 coreTypes.ts # Core application type definitions
│   │   │   │   └── 📄 global_bridge_types.ts # Types for global window objects
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 AppUI.ts
│   │   │   │   ├── 📄 I18nUI.ts
│   │   │   │   ├── 📄 NavigationUI.ts
│   │   │   │   ├── 📄 Particles.ts
│   │   │   │   ├── 📄 SidebarUI.ts
│   │   │   │   └── 📄 WindowUI.ts
│   │   │   ├── 📄 core.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 dashboard
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DashboardUI.ts # Main dashboard overview renderer
│   │   │   └── 📄 index.ts # Module entry point
│   │   ├── 📁 debug
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 DebugService.ts # Service for debug tools and logging
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DebugUI.ts # UI for debug panel and log viewer
│   │   │   └── 📄 index.ts # Module entry point
│   │   ├── 📁 downloader
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 downloaderTypes.ts # Type definitions for downloader
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DownloadUI.ts # UI for module download manager
│   │   │   └── 📄 index.ts # Module entry point
│   │   ├── 📁 monitoring
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 MonitoringService.ts # System resource monitoring service
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 monitoringTypes.ts # Monitoring data types
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 MonitoringUI.ts # System monitor UI renderer
│   │   │   └── 📄 index.ts # Module entry point
│   │   └── 📁 settings
│   │       ├── 📁 services
│   │       │   └── 📄 SettingsService.ts # Manages app settings persistence
│   │       ├── 📁 ui
│   │       │   ├── 📁 components
│   │       │   │   ├── 📄 CardResizer.ts # Logic for resizing settings cards
│   │       │   │   ├── 📄 FieldFactory.ts # Factory for creating setting fields
│   │       │   │   ├── 📄 ISettingField.ts # Interface for setting field components
│   │       │   │   ├── 📄 NumberField.ts # Component for number input fields
│   │       │   │   ├── 📄 SelectField.ts # Component for dropdown selection fields
│   │       │   │   ├── 📄 TextField.ts # Component for text input fields
│   │       │   │   └── 📄 ToggleField.ts # Component for checkbox toggle fields
│   │       │   ├── 📄 GeneralSettingsRenderer.ts # Renders general application settings
│   │       │   ├── 📄 SettingsContext.ts # Context provider for Settings UI dependencies
│   │       │   └── 📄 SettingsUI.ts # Main Settings UI orchestrator
│   │       └── 📄 index.ts # Module entry point
│   ├── 📁 public
│   │   └── 📁 templates
│   │       ├── 📁 components
│   │       │   └── 🌐 sidebar.html
│   │       ├── 📁 modals
│   │       └── 📁 pages
│   │           └── 🌐 settings.html
│   ├── 📁 scripts
│   │   ├── 📄 analyze-lint-v2.cjs # Script for analyzing linting results
│   │   ├── 📄 bump-version.js # Version bumping utility
│   │   └── 📄 check-size.js # Bundle size checker
│   ├── 📁 test
│   │   ├── 📄 AIBridge.test.ts # Unit tests for AIBridge
│   │   ├── 📄 ChatFileHandler.test.ts # Unit tests for ChatFileHandler
│   │   ├── 📄 ErrorHandler.test.ts # Unit tests for ErrorHandler
│   │   ├── 📄 EventBus.test.ts # Unit tests for EventBus
│   │   ├── 📄 I18nService.test.ts # Unit tests for I18nService
│   │   ├── 📄 ModuleService.test.ts # Unit tests for ModuleService
│   │   ├── 📄 NavigationService.test.ts # Unit tests for NavigationService
│   │   ├── 📄 StateService.test.ts # Unit tests for StateService
│   │   ├── 📄 TauriProvider.test.ts # Unit tests for TauriProvider
│   │   ├── 📄 VoiceInputService.test.ts # Unit tests for VoiceInputService
│   │   ├── 📄 setup.test.ts # Global test setup configuration
│   │   ├── 📄 setup.ts # Test environment initialization
│   │   └── 📄 templateLoader.test.ts # Unit tests for TemplateLoader
│   ├── 📁 types
│   │   └── 📄 global.d.ts
│   ├── ⚙️ .prettierignore
│   ├── ⚙️ .prettierrc
│   ├── 📄 eslint.config.js
│   ├── 🌐 index.html
│   ├── ⚙️ package.json
│   ├── ⚙️ tsconfig.json
│   ├── 📄 vite-env.d.ts
│   └── 📄 vite.config.ts
├── 📁 src-tauri
│   ├── 📁 capabilities
│   │   └── ⚙️ default.json
│   ├── 📁 icons
│   │   ├── 📄 icon.ico
│   │   ├── 🖼️ icon.png
│   │   └── 🖼️ icon.svg
│   ├── 📁 resources
│   │   ├── 📁 config
│   │   │   └── ⚙️ defaults.json
│   │   ├── 📁 locales
│   │   │   ├── ⚙️ en.json
│   │   │   ├── ⚙️ ru.json
│   │   │   └── ⚙️ zh.json
│   │   ├── 📁 modules
│   │   └── ⚙️ api_providers.json
│   ├── 📁 src
│   │   ├── 📁 commands
│   │   │   ├── 🦀 ai.rs # AI-related Tauri commands
│   │   │   ├── 🦀 bootstrap.rs # App bootstrap commands
│   │   │   ├── 🦀 config.rs # Configuration management commands
│   │   │   ├── 🦀 downloader.rs # Module download commands
│   │   │   ├── 🦀 health.rs # Health check commands
│   │   │   ├── 🦀 license.rs # License management commands
│   │   │   ├── 🦀 logs.rs # Logging commands
│   │   │   ├── 🦀 mod.rs # Module definition for commands
│   │   │   ├── 🦀 modules.rs # Module lifecycle commands
│   │   │   ├── 🦀 secure.rs # Secure storage commands
│   │   │   ├── 🦀 settings.rs # Settings management commands
│   │   │   ├── 🦀 system.rs # System information commands
│   │   │   ├── 🦀 theme.rs # Theme management commands
│   │   │   ├── 🦀 translations.rs # I18n commands
│   │   │   ├── 🦀 ui_state.rs # UI state persistence commands
│   │   │   ├── 🦀 window.rs # Window control commands
│   │   │   └── 🦀 window_settings.rs # Window settings commands
│   │   ├── 📁 models
│   │   │   ├── 🦀 config.rs # Configuration structs
│   │   │   ├── 🦀 custom_models.rs # Custom model structs
│   │   │   ├── 🦀 license.rs # License structs
│   │   │   ├── 🦀 mod.rs # Module definition for models
│   │   │   ├── 🦀 module.rs # Module item structs
│   │   │   ├── 🦀 modules.rs # Module collection structs
│   │   │   ├── 🦀 settings.rs # Settings structs
│   │   │   ├── 🦀 system.rs # System info structs
│   │   │   └── 🦀 ui_state.rs # UI state structs
│   │   ├── 📁 services
│   │   │   ├── 📁 license
│   │   │   │   ├── 🦀 mod.rs # Module definition for license service
│   │   │   │   ├── 🦀 storage.rs # License storage logic
│   │   │   │   ├── 🦀 types.rs # License service types
│   │   │   │   └── 🦀 verifier.rs # License verification logic
│   │   │   ├── 🦀 ai_service.rs # Core AI service logic
│   │   │   ├── 🦀 config_service.rs # Configuration loading/saving
│   │   │   ├── 🦀 custom_model_service.rs # Custom model management
│   │   │   ├── 🦀 downloader.rs # Download manager service
│   │   │   ├── 🦀 file_service.rs # File system operations
│   │   │   ├── 🦀 health.rs # System health monitoring
│   │   │   ├── 🦀 logs.rs # Logger implementation
│   │   │   ├── 🦀 mod.rs # Module definition for services
│   │   │   ├── 🦀 module_controller.rs # Module execution controller
│   │   │   ├── 🦀 module_lifecycle.rs # Module lifecycle manager
│   │   │   ├── 🦀 secure_storage.rs # Secure storage service (keytar)
│   │   │   ├── 🦀 server.rs # Local server implementation
│   │   │   ├── 🦀 settings.rs # Settings persistence service
│   │   │   ├── 🦀 system_monitor.rs # System resource monitor
│   │   │   ├── 🦀 theme.rs # Theme manager
│   │   │   ├── 🦀 translations.rs # Translation loader
│   │   │   ├── 🦀 ui_state.rs # UI state manager
│   │   │   └── 🦀 window_settings.rs # Window settings manager
│   │   ├── 📁 utils
│   │   │   ├── 🦀 memory.rs # Memory management utils
│   │   │   ├── 🦀 mod.rs # Module definition for utils
│   │   │   ├── 🦀 paths.rs # Path resolution utils
│   │   │   ├── 🦀 process.rs # Process management utils
│   │   │   ├── 🦀 setup.rs # App setup helpers
│   │   │   └── 🦀 windows.rs # Windows-specific utils
│   │   ├── 🦀 errors.rs # Custom error types
│   │   ├── 🦀 lib.rs # Library entry point
│   │   ├── 🦀 main.rs # Application entry point
│   │   └── 🦀 tests.rs # Rust unit tests
│   ├── ⚙️ Cargo.toml # Rust dependencies and metadata
│   ├── 🦀 build.rs # Build script
│   ├── ⚙️ rustfmt.toml # Rust formatting config
│   └── ⚙️ tauri.conf.json # Tauri configuration
├── ⚙️ .editorconfig # Editor configuration rules
├── ⚙️ .gitattributes # Git attribute configurations
├── ⚙️ .gitignore # Git ignore rules
├── ⚙️ .prettierignore # Prettier ignore rules
├── 📝 CODE_OF_CONDUCT.md # Code of conduct for contributors
├── 📝 CONTRIBUTING.md # Contribution guidelines
├── 📄 LICENSE # Project license
├── 📝 README.md # Project readme
├── 📝 SECURITY.md # Security policy
└── ⚙️ package.json # Project dependencies and scripts
```

---

# Proposed Structure (v2.0)

> [!NOTE]
> Ниже представлена предлагаемая новая структура проекта, основанная на принципах **Vertical Slice Architecture** и **Clean Architecture**.

## Frontend (`src/`)

```
├── 📁 src
│   ├── 📁 app                                    # 🚀 Application Bootstrap
│   │   ├── 📄 init.ts                            # Entry point, Core initialization
│   │   ├── 📄 bridge.ts                          # GlobalBridge facade (exposes services to window)
│   │   ├── 📄 router.ts                          # NavigationService wrapper
│   │   └── 📄 events.ts                          # EventHandler (central event handling logic)
│   │
│   ├── 📁 features                               # 📦 Feature Modules (Vertical Slices)
│   │   │
│   │   ├── 📁 ai                                 # AI Integration Feature
│   │   │   ├── 📁 components
│   │   │   │   └── 📄 AISettingsRenderer.ts      # Renders AI provider settings UI
│   │   │   ├── 📁 providers
│   │   │   │   └── 📄 AIProvider.ts              # Abstract base class for AI providers
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 AIBridge.ts                # Bridge for AI operations (streaming, chat)
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 ai.types.ts                # Type definitions for AI models/responses
│   │   │   ├── 📁 utils
│   │   │   │   └── 📄 catalogHelpers.ts          # Helpers for AI model catalog operations
│   │   │   ├── 📄 ai.test.ts                     # Unit tests for AI feature (co-located)
│   │   │   └── 📄 index.ts                       # Module public API exports
│   │   │
│   │   ├── 📁 chat                               # Chat Interface Feature
│   │   │   ├── 📁 components
│   │   │   │   └── 📄 ChatUI.ts                  # Chat interface renderer
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 ChatService.ts             # Core chat logic and state
│   │   │   │   ├── 📄 ChatFileHandler.ts         # File attachments in chat
│   │   │   │   └── 📄 VoiceInputService.ts       # Voice input / STT handling
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 chat.types.ts              # Chat-related type definitions
│   │   │   ├── 📁 utils
│   │   │   │   └── 📄 chatUtils.ts               # Utility functions for chat formatting
│   │   │   ├── 📄 chat.test.ts                   # Unit tests for Chat feature
│   │   │   └── 📄 index.ts                       # Module public API exports
│   │   │
│   │   ├── 📁 dashboard                          # Dashboard Feature
│   │   │   ├── 📁 components
│   │   │   │   └── 📄 DashboardUI.ts             # Main dashboard overview renderer
│   │   │   ├── 📄 dashboard.test.ts              # Unit tests for Dashboard
│   │   │   └── 📄 index.ts                       # Module public API exports
│   │   │
│   │   ├── 📁 debug                              # Debug Tools Feature
│   │   │   ├── 📁 components
│   │   │   │   └── 📄 DebugUI.ts                 # Debug panel and log viewer UI
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 DebugService.ts            # Debug tools and logging service
│   │   │   ├── 📄 debug.test.ts                  # Unit tests for Debug feature
│   │   │   └── 📄 index.ts                       # Module public API exports
│   │   │
│   │   ├── 📁 downloads                          # Module Downloads Feature
│   │   │   ├── 📁 components
│   │   │   │   └── 📄 DownloadUI.ts              # Download manager UI
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 download.types.ts          # Download-related type definitions
│   │   │   ├── 📄 downloads.test.ts              # Unit tests for Downloads
│   │   │   └── 📄 index.ts                       # Module public API exports
│   │   │
│   │   ├── 📁 monitoring                         # System Monitoring Feature
│   │   │   ├── 📁 components
│   │   │   │   └── 📄 MonitoringUI.ts            # System monitor UI renderer
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 MonitoringService.ts       # System resource monitoring service
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 monitoring.types.ts        # Monitoring data types
│   │   │   ├── 📄 monitoring.test.ts             # Unit tests for Monitoring
│   │   │   └── 📄 index.ts                       # Module public API exports
│   │   │
│   │   └── 📁 settings                           # Settings Feature
│   │       ├── 📁 components
│   │       │   ├── 📁 fields                     # Setting field components
│   │       │   │   ├── 📄 ISettingField.ts       # Interface for setting field components
│   │       │   │   ├── 📄 FieldFactory.ts        # Factory for creating setting fields
│   │       │   │   ├── 📄 NumberField.ts         # Number input field component
│   │       │   │   ├── 📄 SelectField.ts         # Dropdown selection field component
│   │       │   │   ├── 📄 TextField.ts           # Text input field component
│   │       │   │   └── 📄 ToggleField.ts         # Checkbox toggle field component
│   │       │   ├── 📄 CardResizer.ts             # Logic for resizing settings cards
│   │       │   ├── 📄 GeneralSettingsRenderer.ts # Renders general application settings
│   │       │   ├── 📄 SettingsContext.ts         # Context provider for Settings UI
│   │       │   └── 📄 SettingsUI.ts              # Main Settings UI orchestrator
│   │       ├── 📁 services
│   │       │   └── 📄 SettingsService.ts         # Manages app settings persistence
│   │       ├── 📄 settings.test.ts               # Unit tests for Settings
│   │       └── 📄 index.ts                       # Module public API exports
│   │
│   ├── 📁 shared                                 # 🔗 Cross-Cutting Concerns
│   │   ├── 📁 services
│   │   │   ├── 📄 EventBus.ts                    # Pub/Sub event bus implementation
│   │   │   ├── 📄 StateService.ts                # Manages global application state
│   │   │   ├── 📄 LoggerService.ts               # Application logging service
│   │   │   ├── 📄 ErrorHandler.ts                # Global error handling service
│   │   │   ├── 📄 SoundService.ts                # UI sound effects manager
│   │   │   ├── 📄 ModuleService.ts               # Manages module downloads and lifecycle
│   │   │   ├── 📄 CatalogService.ts              # Manages app catalog and configuration
│   │   │   ├── 📄 TemplateLoader.ts              # Loads HTML templates for UI
│   │   │   └── 📄 WindowService.ts               # Window management (maximize, minimize, etc.)
│   │   ├── 📁 components
│   │   │   ├── 📄 Particles.ts                   # Background particles effect
│   │   │   ├── 📄 SidebarUI.ts                   # Sidebar navigation component
│   │   │   ├── 📄 WindowUI.ts                    # Window controls (min/max/close)
│   │   │   └── 📄 AppUI.ts                       # App catalog UI renderer
│   │   ├── 📁 types
│   │   │   ├── 📄 core.types.ts                  # Core application type definitions
│   │   │   ├── 📄 bindings.ts                    # TypeScript bindings for Rust structs
│   │   │   ├── 📄 global_bridge.types.ts         # Types for global window objects
│   │   │   └── 📄 global.d.ts                    # Global TypeScript declarations
│   │   └── 📁 utils
│   │       └── 📄 helpers.ts                     # Common utility functions
│   │
│   ├── 📁 infrastructure                         # 🔌 External Adapters
│   │   ├── 📁 tauri
│   │   │   ├── 📄 TauriProvider.ts               # Bridge to Tauri backend commands
│   │   │   └── 📄 TauriProvider.test.ts          # Unit tests for TauriProvider
│   │   ├── 📁 storage
│   │   │   └── 📄 SecureStorageAdapter.ts        # Adapter for secure key storage
│   │   ├── 📁 i18n
│   │   │   ├── 📄 I18nService.ts                 # Internationalization service
│   │   │   ├── 📄 I18nUI.ts                      # I18n UI helpers
│   │   │   └── 📄 I18nService.test.ts            # Unit tests for I18nService
│   │   └── 📁 navigation
│   │       ├── 📄 NavigationService.ts           # Page navigation service
│   │       ├── 📄 NavigationUI.ts                # Navigation UI helpers
│   │       └── 📄 NavigationService.test.ts      # Unit tests for NavigationService
│   │
│   ├── 📁 styles                                 # 🎨 CSS Stylesheets
│   │   ├── 📁 tokens
│   │   │   └── 🎨 variables.css                  # Design tokens (colors, spacing, etc.)
│   │   ├── 📁 base
│   │   │   ├── 🎨 reset.css                      # CSS Reset/Normalize
│   │   │   ├── 🎨 scrollbar.css                  # Custom scrollbar styles
│   │   │   └── 🎨 animations.css                 # Keyframe animations
│   │   ├── 📁 components
│   │   │   ├── 🎨 buttons.css                    # Button styles
│   │   │   ├── 🎨 cards.css                      # Card component styles
│   │   │   ├── 🎨 forms.css                      # Form input styles
│   │   │   ├── 🎨 icons.css                      # Icon styles
│   │   │   └── 🎨 status.css                     # Status indicator styles
│   │   ├── 📁 layouts
│   │   │   ├── 🎨 controls.css                   # Window controls layout
│   │   │   ├── 🎨 main-area.css                  # Main content area layout
│   │   │   ├── 🎨 sidebar.css                    # Sidebar layout
│   │   │   ├── 🎨 modals.css                     # Modal dialog layout
│   │   │   ├── 🎨 toasts.css                     # Toast notification layout
│   │   │   └── 🎨 splash.css                     # Splash screen layout
│   │   ├── 📁 features
│   │   │   ├── 🎨 ai-settings.css                # AI settings page styles
│   │   │   ├── 🎨 chat.css                       # Chat interface styles
│   │   │   ├── 🎨 dashboard.css                  # Dashboard styles
│   │   │   ├── 🎨 debug.css                      # Debug panel styles
│   │   │   ├── 🎨 downloads.css                  # Downloads page styles
│   │   │   ├── 🎨 monitoring.css                 # Monitoring page styles
│   │   │   └── 🎨 settings.css                   # Settings page styles
│   │   └── 🎨 main.css                           # CSS entry point (@imports)
│   │
│   ├── 📁 templates                              # 🌐 HTML Templates
│   │   ├── 📁 components
│   │   │   └── 🌐 sidebar.html                   # Sidebar template
│   │   ├── 📁 pages
│   │   │   └── 🌐 settings.html                  # Settings page template
│   │   └── 📁 modals
│   │       └── 🌐 confirm.html                   # Confirmation modal template
│   │
│   ├── 📁 assets                                 # 📁 Static Assets
│   │   ├── 📁 fonts
│   │   │   ├── 📄 Cubic_11.ttf                   # Cubic 11 font
│   │   │   └── 📄 Monocraft.otf                  # Monocraft font
│   │   ├── 📄 icons.ts                           # Icon SVG exports
│   │   └── 📄 logos.ts                           # Logo exports
│   │
│   ├── 📁 scripts                                # 📄 Build Scripts
│   │   ├── 📄 analyze-lint-v2.cjs                # Lint analysis script
│   │   ├── 📄 bump-version.js                    # Version bumping utility
│   │   └── 📄 check-size.js                      # Bundle size checker
│   │
│   ├── 📁 test                                    # 🧪 Test Infrastructure
│   │   ├── 📄 setup.ts                           # Test environment initialization
│   │   └── 📄 setup.test.ts                      # Global test setup configuration
│   │
│   ├── ⚙️ .prettierignore                        # Prettier ignore rules
│   ├── ⚙️ .prettierrc                            # Prettier configuration
│   ├── 📄 eslint.config.js                       # ESLint configuration
│   ├── 🌐 index.html                             # HTML entry point
│   ├── ⚙️ package.json                           # Frontend dependencies
│   ├── ⚙️ tsconfig.json                          # TypeScript configuration
│   ├── 📄 vite-env.d.ts                          # Vite environment types
│   └── 📄 vite.config.ts                         # Vite configuration
```

## Backend (`src-tauri/src/`)

```
├── 📁 src-tauri
│   ├── 📁 capabilities
│   │   └── ⚙️ default.json                       # Tauri capability permissions
│   │
│   ├── 📁 icons
│   │   ├── 📄 icon.ico                           # Windows icon
│   │   ├── 🖼️ icon.png                           # PNG icon
│   │   └── 🖼️ icon.svg                           # SVG icon
│   │
│   ├── 📁 resources
│   │   ├── 📁 config
│   │   │   └── ⚙️ defaults.json                  # Default configuration values
│   │   ├── 📁 locales
│   │   │   ├── ⚙️ en.json                        # English translations
│   │   │   ├── ⚙️ ru.json                        # Russian translations
│   │   │   └── ⚙️ zh.json                        # Chinese translations
│   │   ├── 📁 modules
│   │   │   └── 📄 .gitkeep                       # Placeholder for downloaded modules
│   │   └── ⚙️ api_providers.json                 # AI provider configuration
│   │
│   ├── 📁 src
│   │   │
│   │   ├── 📁 api                                # 🌐 IPC Commands (grouped by domain)
│   │   │   ├── 📁 ai
│   │   │   │   └── 🦀 mod.rs                     # send_chat_message, get_providers
│   │   │   ├── 📁 modules
│   │   │   │   └── 🦀 mod.rs                     # download_module, start_module, stop_module
│   │   │   ├── 📁 settings
│   │   │   │   └── 🦀 mod.rs                     # get_settings, save_settings, get_locale
│   │   │   ├── 📁 system
│   │   │   │   └── 🦀 mod.rs                     # get_system_stats, health_check, open_in_explorer
│   │   │   ├── 📁 window
│   │   │   │   └── 🦀 mod.rs                     # minimize, maximize, close, get_window_settings
│   │   │   ├── 📁 secure
│   │   │   │   └── 🦀 mod.rs                     # save_secure_key, get_secure_key
│   │   │   ├── 📁 license
│   │   │   │   └── 🦀 mod.rs                     # get_license_status, activate_license
│   │   │   └── 🦀 mod.rs                         # Re-exports all command handlers
│   │   │
│   │   ├── 📁 domain                             # 🧠 Business Logic
│   │   │   ├── 📁 ai
│   │   │   │   ├── 🦀 mod.rs                     # AI domain module definition
│   │   │   │   ├── 🦀 ai_service.rs              # Core AI service (providers, streaming)
│   │   │   │   └── 🦀 custom_model_service.rs    # Custom model management
│   │   │   ├── 📁 modules
│   │   │   │   ├── 🦀 mod.rs                     # Modules domain definition
│   │   │   │   ├── 🦀 controller.rs              # Module execution controller
│   │   │   │   ├── 🦀 lifecycle.rs               # Module lifecycle manager
│   │   │   │   └── 🦀 downloader.rs              # Module download manager
│   │   │   ├── 📁 license
│   │   │   │   ├── 🦀 mod.rs                     # License domain definition
│   │   │   │   ├── 🦀 storage.rs                 # License storage logic
│   │   │   │   ├── 🦀 verifier.rs                # License verification logic
│   │   │   │   └── 🦀 types.rs                   # License-specific types
│   │   │   ├── 📁 monitoring
│   │   │   │   ├── 🦀 mod.rs                     # Monitoring domain definition
│   │   │   │   └── 🦀 system_monitor.rs          # System resource monitor
│   │   │   └── 🦀 mod.rs                         # Domain layer entry point
│   │   │
│   │   ├── 📁 infrastructure                     # 🔧 External Concerns
│   │   │   ├── 📁 crypto
│   │   │   │   ├── 🦀 mod.rs                     # Crypto module definition
│   │   │   │   └── 🦀 secure_storage.rs          # AES-256-GCM encryption service
│   │   │   ├── 📁 filesystem
│   │   │   │   ├── 🦀 mod.rs                     # Filesystem module definition
│   │   │   │   └── 🦀 file_service.rs            # File system operations
│   │   │   ├── 📁 http
│   │   │   │   ├── 🦀 mod.rs                     # HTTP module definition
│   │   │   │   └── 🦀 server.rs                  # Local HTTP server
│   │   │   ├── 📁 logging
│   │   │   │   ├── 🦀 mod.rs                     # Logging module definition
│   │   │   │   └── 🦀 logger.rs                  # File logger implementation
│   │   │   ├── 📁 config
│   │   │   │   ├── 🦀 mod.rs                     # Config module definition
│   │   │   │   ├── 🦀 config_service.rs          # Configuration loading/saving
│   │   │   │   ├── 🦀 settings.rs                # Settings persistence
│   │   │   │   ├── 🦀 theme.rs                   # Theme manager
│   │   │   │   ├── 🦀 translations.rs            # Translation loader
│   │   │   │   ├── 🦀 ui_state.rs                # UI state persistence
│   │   │   │   └── 🦀 window_settings.rs         # Window settings manager
│   │   │   └── 🦀 mod.rs                         # Infrastructure layer entry point
│   │   │
│   │   ├── 📁 models                             # 📋 Data Structures
│   │   │   ├── 🦀 mod.rs                         # Module definition for models
│   │   │   ├── 🦀 config.rs                      # Configuration structs
│   │   │   ├── 🦀 custom_models.rs               # Custom AI model structs
│   │   │   ├── 🦀 license.rs                     # License structs
│   │   │   ├── 🦀 module.rs                      # Module item structs
│   │   │   ├── 🦀 modules.rs                     # Module collection structs
│   │   │   ├── 🦀 settings.rs                    # Settings structs
│   │   │   ├── 🦀 system.rs                      # System info structs
│   │   │   └── 🦀 ui_state.rs                    # UI state structs
│   │   │
│   │   ├── 📁 utils                              # 🛠 Utilities
│   │   │   ├── 🦀 mod.rs                         # Module definition for utils
│   │   │   ├── 🦀 memory.rs                      # Memory management utilities
│   │   │   ├── 🦀 paths.rs                       # Path resolution utilities
│   │   │   ├── 🦀 process.rs                     # Process management utilities
│   │   │   ├── 🦀 setup.rs                       # App setup helpers
│   │   │   └── 🦀 windows.rs                     # Windows-specific utilities
│   │   │
│   │   ├── 🦀 errors.rs                          # Custom error types (AppError)
│   │   ├── 🦀 lib.rs                             # Library entry point
│   │   ├── 🦀 main.rs                            # Application entry point
│   │   └── 🦀 tests.rs                           # Rust unit tests
│   │
│   ├── ⚙️ Cargo.toml                             # Rust dependencies and metadata
│   ├── 🦀 build.rs                               # Build script
│   ├── ⚙️ rustfmt.toml                           # Rust formatting config
│   └── ⚙️ tauri.conf.json                        # Tauri configuration
```

## Key Changes Summary

| Layer | Old | New |
|-------|-----|-----|
| **Frontend Core** | `modules/core/` (25 items) | Split into `app/` + `shared/` + `infrastructure/` |
| **Frontend Modules** | `modules/` | `features/` (vertical slices) |
| **Frontend Tests** | `test/` (separate) | Co-located with features (`*.test.ts`) |
| **Frontend CSS** | `css/` | `styles/` with `tokens/`, `layouts/`, `features/` |
| **Backend Commands** | `commands/` (flat, 17 files) | `api/{domain}/mod.rs` (grouped) |
| **Backend Services** | `services/` (flat, 18 files) | `domain/` + `infrastructure/` (layered) |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (TypeScript)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌────────────────────────────────────────────┐   │
│  │   app/   │  │              features/                      │   │
│  │ ──────── │  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ │   │
│  │ init.ts  │──│  │ ai │ │chat│ │dash│ │dbg │ │dwn │ │set │ │   │
│  │ bridge.ts│  │  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ │   │
│  │ router.ts│  └────────────────────────────────────────────┘   │
│  └──────────┘                        │                          │
│       │                              ▼                          │
│       │         ┌─────────────────────────────────────┐         │
│       └────────▶│            shared/                   │         │
│                 │  EventBus, StateService, Logger      │         │
│                 │  Toast, Modal, AppUI components      │         │
│                 └─────────────────────────────────────┘         │
│                              │                                   │
│                              ▼                                   │
│                 ┌─────────────────────────────────────┐         │
│                 │        infrastructure/               │         │
│                 │  TauriProvider, I18nService          │         │
│                 │  NavigationService, Storage          │         │
│                 └─────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                               │ IPC
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND (Rust)                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                        api/                               │   │
│  │   ai/ │ modules/ │ settings/ │ system/ │ window/ │ ...   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                       domain/                             │   │
│  │   ai/           │ modules/        │ license/  │ monitor/ │   │
│  │   ai_service.rs │ controller.rs   │ verifier  │ system   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   infrastructure/                         │   │
│  │   crypto/    │ filesystem/ │ http/   │ logging/ │ config/│   │
│  │   AES-256    │ file_svc    │ server  │ logger   │ theme  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

---

## Future Expansion (Roadmap)

> [!NOTE]
> Лаунчер работает как **туннель к Marketplace** (отдельный веб-сайт).
> Авторы публикуют модули на сайте → лаунчер скачивает и запускает.

### Phase 1: WASM Runtime

```
├── 📁 domain                          # Backend
│   └── 📁 runtime                     # [NEW] WASM Script Executor
│       ├── 🦀 executor.rs             # WASM sandbox execution engine
│       ├── 🦀 memory_guard.rs         # Anti-tamper memory protection
│       └── 🦀 mod.rs                  # Module exports

├── 📁 features                        # Frontend
│   └── 📁 script-runner               # [NEW] WASM execution UI
│       ├── 📁 components
│       │   └── 📄 RunnerUI.ts         # Script execution interface
│       ├── 📄 script-runner.test.ts
│       └── 📄 index.ts
```

### Phase 2: TPM 2.0 & DRM

```
├── 📁 infrastructure                  # Backend
│   └── 📁 tpm                         # [NEW] Hardware Security
│       ├── 🦀 tpm_provider.rs         # TPM 2.0 Windows adapter
│       ├── 🦀 license_verifier.rs     # Hardware-bound license validation
│       └── 🦀 mod.rs
```

### Phase 3: Cross-Platform

```
├── 📁 infrastructure                  # Backend
│   └── 📁 platform                    # [NEW] OS-Specific Code
│       ├── 🦀 windows.rs              # Windows-specific APIs
│       ├── 🦀 macos.rs                # macOS Secure Enclave adapter
│       ├── 🦀 linux.rs                # Linux keyring adapter
│       └── 🦀 mod.rs                  # Platform detection & dispatch

├── 📁 infrastructure                  # Frontend
│   └── 📁 platform                    # [NEW] OS-Specific UI
│       ├── 📄 PlatformAdapter.ts      # Platform detection
│       └── 📄 PlatformAdapter.test.ts
```

### Architecture: Marketplace Integration

```
┌──────────────────────────────────────────────────────────────────────┐
│                         AXELATE ECOSYSTEM                             │
├─────────────────────┬──────────────────────┬─────────────────────────┤
│   🌐 MARKETPLACE    │    🚀 LAUNCHER       │      🗄️ SQL API         │
│   (web)             │    (this project)    │      (backend)          │
├─────────────────────┼──────────────────────┼─────────────────────────┤
│ - Authors publish   │ - Fetch catalog      │ - Module catalog        │
│ - Licenses/payments │ - Download modules   │ - Licenses DB           │
│ - User management   │ - Run WASM scripts   │ - User auth             │
│ - Reviews/ratings   │ - TPM verification   │ - Analytics             │
└─────────────────────┴──────────────────────┴─────────────────────────┘
         ↓                    ↓ ↑                      ↓
     React/Next.js         Tauri + Rust           Rust + PostgreSQL
                               │
                    ┌──────────┴──────────┐
                    │  CatalogService.ts  │
                    │  (API client)       │
                    └─────────────────────┘
```