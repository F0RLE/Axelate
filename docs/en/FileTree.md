# File Tree: Axelate

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