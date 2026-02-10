# File Tree: Axelate

```
├── 📁 .github
│   ├── 📁 .husky
│   │   ├── 📄 commit-msg
│   │   └── 📄 pre-commit
│   ├── 📁 ISSUE_TEMPLATE
│   │   ├── 📝 bug_report.md
│   │   └── 📝 feature_request.md
│   ├── 📁 scripts
│   │   ├── 📄 clear.ps1
│   │   ├── 📄 dev.ps1
│   │   ├── 📄 release.ps1
│   │   ├── 📄 update.ps1
│   │   └── 📄 verify-all.ps1
│   ├── 📁 workflows
│   │   ├── ⚙️ ci.yml
│   │   └── ⚙️ release.yml
│   ├── 📝 CODE_OF_CONDUCT.md
│   ├── 📝 CONTRIBUTING.md
│   ├── 📝 PULL_REQUEST_TEMPLATE.md
│   ├── 📝 SECURITY.md
│   ├── 📄 commitlint.config.js
│   └── ⚙️ dependabot.yml
├── 📁 docs
│   ├── 📁 en
│   │   ├── 📝 CODING_STANDARDS.md
│   │   ├── 📝 FileTree.md
│   │   ├── 📝 architecture.md
│   │   └── 📝 getting-started.md
│   ├── 📁 ru
│   │   └── 📝 VISION.md
│   └── 📁 zn
├── 📁 src
│   ├── 📁 app
│   │   ├── 📄 bridge.ts
│   │   ├── 📄 events.ts
│   │   ├── 📄 init.ts
│   │   └── 📄 router.ts
│   ├── 📁 assets
│   │   ├── 📁 fonts
│   │   │   ├── 📄 Cubic_11.ttf
│   │   │   └── 📄 Monocraft.otf
│   │   ├── 📄 icons.ts
│   │   └── 📄 logos.ts
│   ├── 📁 features
│   │   ├── 📁 ai
│   │   │   ├── 📁 providers
│   │   │   │   └── 📄 AIProvider.ts
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 AIBridge.test.ts
│   │   │   │   └── 📄 AIBridge.ts
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 aiTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 AISettingsRenderer.ts
│   │   │   ├── 📁 utils
│   │   │   │   └── 📄 catalogHelpers.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 chat
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 ChatFileHandler.test.ts
│   │   │   │   ├── 📄 ChatFileHandler.ts
│   │   │   │   ├── 📄 ChatService.ts
│   │   │   │   ├── 📄 VoiceInputService.test.ts
│   │   │   │   └── 📄 VoiceInputService.ts
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 chatTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 ChatUI.ts
│   │   │   ├── 📁 utils
│   │   │   │   └── 📄 chatUtils.ts
│   │   │   ├── 📄 chat.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 dashboard
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DashboardUI.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 debug
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 DebugService.ts
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DebugUI.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 downloads
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 downloaderTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DownloadUI.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 monitoring
│   │   │   ├── 📁 services
│   │   │   │   └── 📄 MonitoringService.ts
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 monitoringTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 MonitoringUI.ts
│   │   │   └── 📄 index.ts
│   │   └── 📁 settings
│   │       ├── 📁 services
│   │       │   └── 📄 SettingsService.ts
│   │       ├── 📁 ui
│   │       │   ├── 📁 components
│   │       │   │   ├── 📄 CardResizer.ts
│   │       │   │   ├── 📄 FieldFactory.ts
│   │       │   │   ├── 📄 ISettingField.ts
│   │       │   │   ├── 📄 NumberField.ts
│   │       │   │   ├── 📄 SelectField.ts
│   │       │   │   ├── 📄 TextField.ts
│   │       │   │   └── 📄 ToggleField.ts
│   │       │   ├── 📄 GeneralSettingsRenderer.ts
│   │       │   ├── 📄 SettingsContext.ts
│   │       │   └── 📄 SettingsUI.ts
│   │       └── 📄 index.ts
│   ├── 📁 infrastructure
│   │   ├── 📁 i18n
│   │   │   ├── 📄 I18nService.test.ts
│   │   │   ├── 📄 I18nService.ts
│   │   │   └── 📄 I18nUI.ts
│   │   ├── 📁 navigation
│   │   │   ├── 📄 NavigationService.test.ts
│   │   │   ├── 📄 NavigationService.ts
│   │   │   └── 📄 NavigationUI.ts
│   │   ├── 📁 storage
│   │   └── 📁 tauri
│   │       ├── 📄 TauriProvider.test.ts
│   │       └── 📄 TauriProvider.ts
│   ├── 📁 scripts
│   │   ├── 📄 analyze-lint-v2.cjs
│   │   ├── 📄 bump-version.js
│   │   └── 📄 check-size.js
│   ├── 📁 shared
│   │   ├── 📁 components
│   │   │   ├── 📄 AppUI.ts
│   │   │   ├── 📄 Particles.ts
│   │   │   ├── 📄 SidebarUI.ts
│   │   │   └── 📄 WindowUI.ts
│   │   ├── 📁 services
│   │   │   ├── 📄 CatalogService.ts
│   │   │   ├── 📄 ErrorHandler.test.ts
│   │   │   ├── 📄 ErrorHandler.ts
│   │   │   ├── 📄 EventBus.test.ts
│   │   │   ├── 📄 EventBus.ts
│   │   │   ├── 📄 LoggerService.ts
│   │   │   ├── 📄 ModuleService.test.ts
│   │   │   ├── 📄 ModuleService.ts
│   │   │   ├── 📄 SoundService.ts
│   │   │   ├── 📄 StateService.test.ts
│   │   │   ├── 📄 StateService.ts
│   │   │   ├── 📄 TemplateLoader.ts
│   │   │   ├── 📄 WindowService.ts
│   │   │   └── 📄 templateLoader.test.ts
│   │   ├── 📁 types
│   │   │   ├── 📄 bindings.ts
│   │   │   ├── 📄 coreTypes.ts
│   │   │   ├── 📄 global.d.ts
│   │   │   └── 📄 global_bridge_types.ts
│   │   └── 📁 utils
│   ├── 📁 styles
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
│   │   ├── 📁 features
│   │   │   ├── 🎨 ai-settings.css
│   │   │   ├── 🎨 chat.css
│   │   │   ├── 🎨 dashboard.css
│   │   │   ├── 🎨 debug.css
│   │   │   ├── 🎨 downloads.css
│   │   │   ├── 🎨 monitoring.css
│   │   │   └── 🎨 settings.css
│   │   ├── 📁 layouts
│   │   │   ├── 🎨 controls.css
│   │   │   ├── 🎨 main-area.css
│   │   │   ├── 🎨 modals.css
│   │   │   ├── 🎨 sidebar.css
│   │   │   ├── 🎨 splash.css
│   │   │   └── 🎨 toasts.css
│   │   ├── 📁 tokens
│   │   └── 🎨 main.css
│   ├── 📁 templates
│   │   ├── 📁 components
│   │   ├── 📁 modals
│   │   └── 📁 pages
│   ├── 📁 test
│   │   ├── 📄 setup.test.ts
│   │   └── 📄 setup.ts
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
│   │   ├── 📁 tools
│   │   └── ⚙️ api_providers.json
│   ├── 📁 src
│   │   ├── 📁 api
│   │   │   ├── 📁 ai
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 license
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 modules
│   │   │   │   ├── 🦀 downloader.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 secure
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 settings
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 theme.rs
│   │   │   │   ├── 🦀 translations.rs
│   │   │   │   ├── 🦀 ui_state.rs
│   │   │   │   └── 🦀 window_settings.rs
│   │   │   ├── 📁 system
│   │   │   │   ├── 🦀 bootstrap.rs
│   │   │   │   ├── 🦀 config.rs
│   │   │   │   ├── 🦀 health.rs
│   │   │   │   ├── 🦀 logs.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 window
│   │   │   │   └── 🦀 mod.rs
│   │   │   └── 🦀 mod.rs
│   │   ├── 📁 domain
│   │   │   ├── 📁 ai
│   │   │   │   ├── 🦀 ai_service.rs
│   │   │   │   ├── 🦀 custom_model_service.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 license
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 storage.rs
│   │   │   │   ├── 🦀 types.rs
│   │   │   │   └── 🦀 verifier.rs
│   │   │   ├── 📁 modules
│   │   │   │   ├── 🦀 controller.rs
│   │   │   │   ├── 🦀 downloader.rs
│   │   │   │   ├── 🦀 lifecycle.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 monitoring
│   │   │   │   ├── 🦀 health.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 system_monitor.rs
│   │   │   └── 🦀 mod.rs
│   │   ├── 📁 infrastructure
│   │   │   ├── 📁 config
│   │   │   │   ├── 🦀 config_service.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 settings.rs
│   │   │   │   ├── 🦀 theme.rs
│   │   │   │   ├── 🦀 translations.rs
│   │   │   │   ├── 🦀 ui_state.rs
│   │   │   │   └── 🦀 window_settings.rs
│   │   │   ├── 📁 crypto
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 secure_storage.rs
│   │   │   ├── 📁 filesystem
│   │   │   │   ├── 🦀 file_service.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 http
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 server.rs
│   │   │   ├── 📁 logging
│   │   │   │   ├── 🦀 logger.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   └── 🦀 mod.rs
│   │   ├── 📁 models
│   │   │   ├── 🦀 config.rs
│   │   │   ├── 🦀 custom_models.rs
│   │   │   ├── 🦀 license.rs
│   │   │   ├── 🦀 mod.rs
│   │   │   ├── 🦀 module.rs
│   │   │   ├── 🦀 modules.rs
│   │   │   ├── 🦀 settings.rs
│   │   │   ├── 🦀 system.rs
│   │   │   └── 🦀 ui_state.rs
│   │   ├── 📁 utils
│   │   │   ├── 🦀 memory.rs
│   │   │   ├── 🦀 mod.rs
│   │   │   ├── 🦀 paths.rs
│   │   │   ├── 🦀 process.rs
│   │   │   ├── 🦀 setup.rs
│   │   │   └── 🦀 windows.rs
│   │   ├── 🦀 errors.rs
│   │   ├── 🦀 lib.rs
│   │   ├── 🦀 main.rs
│   │   └── 🦀 tests.rs
│   ├── 📄 Cargo.lock
│   ├── ⚙️ Cargo.toml
│   ├── 🦀 build.rs
│   ├── ⚙️ rustfmt.toml
│   └── ⚙️ tauri.conf.json
├── ⚙️ .editorconfig
├── ⚙️ .gitattributes
├── ⚙️ .gitignore
├── 📄 LICENSE
├── 📝 README.md
└── ⚙️ package.json
```