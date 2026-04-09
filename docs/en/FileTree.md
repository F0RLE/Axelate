# File Tree & Architecture: Axelate

This document serves as the single source of truth for the project's folder structure. Every file and directory is accompanied by its direct architectural responsibility, strictly adhering to our KISS and SOLID principles.
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
│   │   ├── 📄 common.ps1
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
│   │   ├── 📝 AUTOMATION.md
│   │   ├── 📝 CODING_STANDARDS.md
│   │   ├── 📝 FileTree.md
│   │   ├── 📝 architecture.md
│   │   └── 📝 getting-started.md
│   ├── 📁 ru
│   │   └── 📝 VISION.md
│   └── 📁 zh
│       └── 📝 README_CN.md
├── 📁 src
│   ├── 📁 app
│   │   ├── 📄 bridge.ts
│   │   ├── 📄 events.ts
│   │   └── 📄 init.ts
│   ├── 📁 assets
│   │   ├── 📁 fonts
│   │   │   ├── 📁 inter
│   │   │   │   ├── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2
│   │   │   │   ├── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
│   │   │   │   ├── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2
│   │   │   │   ├── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2
│   │   │   │   ├── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2
│   │   │   │   ├── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2
│   │   │   │   └── 📄 UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2
│   │   │   ├── 📄 Cubic_11.woff2
│   │   │   └── 📄 Monocraft.woff2
│   │   ├── 📄 icons.ts
│   │   └── 📄 logos.ts
│   ├── 📁 features
│   │   ├── 📁 ai
│   │   │   ├── 📁 providers
│   │   │   │   └── 📄 AIProvider.ts
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 AIBridge.test.ts
│   │   │   │   ├── 📄 AIBridge.ts
│   │   │   │   ├── 📄 AIChatTransport.test.ts
│   │   │   │   ├── 📄 AIChatTransport.ts
│   │   │   │   ├── 📄 AIProviderManager.test.ts
│   │   │   │   ├── 📄 AIProviderManager.ts
│   │   │   │   ├── 📄 EngineConfigService.test.ts
│   │   │   │   ├── 📄 EngineConfigService.ts
│   │   │   │   ├── 📄 EngineStatusService.test.ts
│   │   │   │   └── 📄 EngineStatusService.ts
│   │   │   ├── 📁 types
│   │   │   │   ├── 📄 IAIBridge.ts
│   │   │   │   └── 📄 aiTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 AISettingsRenderer.test.ts
│   │   │   │   └── 📄 AISettingsRenderer.ts
│   │   │   ├── 📁 utils
│   │   │   │   ├── 📄 catalogHelpers.test.ts
│   │   │   │   ├── 📄 catalogHelpers.ts
│   │   │   │   ├── 📄 chatRequestUtils.test.ts
│   │   │   │   └── 📄 chatRequestUtils.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 chat
│   │   │   ├── 📁 controllers
│   │   │   │   ├── 📄 FilePickerController.ts
│   │   │   │   └── 📄 VoiceController.ts
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 ChatFileHandler.test.ts
│   │   │   │   ├── 📄 ChatFileHandler.ts
│   │   │   │   ├── 📄 ChatService.test.ts
│   │   │   │   ├── 📄 ChatService.ts
│   │   │   │   ├── 📄 VoiceInputService.test.ts
│   │   │   │   └── 📄 VoiceInputService.ts
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 chatTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 ChatUI.test.ts
│   │   │   │   └── 📄 ChatUI.ts
│   │   │   ├── 📁 utils
│   │   │   │   ├── 📄 chatUtils.test.ts
│   │   │   │   └── 📄 chatUtils.ts
│   │   │   ├── 📄 chat.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 dashboard
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 DashboardUI.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 debug
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 DebugService.test.ts
│   │   │   │   └── 📄 DebugService.ts
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 DebugUI.test.ts
│   │   │   │   └── 📄 DebugUI.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 downloads
│   │   │   ├── 📁 services
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 downloaderTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 DownloadUI.test.ts
│   │   │   │   └── 📄 DownloadUI.ts
│   │   │   └── 📄 index.ts
│   │   ├── 📁 monitoring
│   │   │   ├── 📁 services
│   │   │   │   ├── 📄 MonitoringService.test.ts
│   │   │   │   └── 📄 MonitoringService.ts
│   │   │   ├── 📁 types
│   │   │   │   └── 📄 monitoringTypes.ts
│   │   │   ├── 📁 ui
│   │   │   │   └── 📄 MonitoringUI.ts
│   │   │   └── 📄 index.ts
│   │   └── 📁 settings
│   │       ├── 📁 services
│   │       │   ├── 📄 SettingsService.test.ts
│   │       │   └── 📄 SettingsService.ts
│   │       ├── 📁 ui
│   │       │   ├── 📁 components
│   │       │   │   ├── 📄 CardResizer.test.ts
│   │       │   │   ├── 📄 CardResizer.ts
│   │       │   │   ├── 📄 FieldComponents.test.ts
│   │       │   │   ├── 📄 FieldFactory.ts
│   │       │   │   ├── 📄 ISettingField.ts
│   │       │   │   ├── 📄 NumberField.ts
│   │       │   │   ├── 📄 SelectField.ts
│   │       │   │   ├── 📄 TextField.ts
│   │       │   │   └── 📄 ToggleField.ts
│   │       │   ├── 📄 GeneralSettingsRenderer.test.ts
│   │       │   ├── 📄 GeneralSettingsRenderer.ts
│   │       │   ├── 📄 ModuleSettingsUI.ts
│   │       │   ├── 📄 SettingsContext.ts
│   │       │   ├── 📄 SettingsUI.test.ts
│   │       │   └── 📄 SettingsUI.ts
│   │       └── 📄 index.ts
│   ├── 📁 infrastructure
│   │   ├── 📁 i18n
│   │   │   ├── 📄 I18nService.test.ts
│   │   │   ├── 📄 I18nService.ts
│   │   │   ├── 📄 I18nUI.test.ts
│   │   │   └── 📄 I18nUI.ts
│   │   ├── 📁 logging
│   │   │   ├── 📄 LoggerService.test.ts
│   │   │   └── 📄 LoggerService.ts
│   │   ├── 📁 navigation
│   │   │   ├── 📄 NavigationService.test.ts
│   │   │   ├── 📄 NavigationService.ts
│   │   │   ├── 📄 NavigationUI.test.ts
│   │   │   └── 📄 NavigationUI.ts
│   │   └── 📁 tauri
│   │       ├── 📄 TauriProvider.test.ts
│   │       └── 📄 TauriProvider.ts
│   ├── 📁 public
│   │   └── 📁 templates
│   │       ├── 📁 components
│   │       │   └── 🌐 sidebar.html
│   │       └── 📁 pages
│   │           ├── 🌐 chat.html
│   │           ├── 🌐 debug.html
│   │           ├── 🌐 downloads.html
│   │           ├── 🌐 home.html
│   │           ├── 🌐 marketplace.html
│   │           ├── 🌐 modules.html
│   │           └── 🌐 settings.html
│   ├── 📁 scripts
│   │   ├── 📄 analyze-lint-v2.cjs
│   │   ├── 📄 bump-version.js
│   │   ├── 📄 check-size.js
│   │   └── 📄 convert-font.js
│   ├── 📁 shared
│   │   ├── 📁 api
│   │   │   ├── 📄 invoke.ts
│   │   │   └── 📄 types.ts
│   │   ├── 📁 config
│   │   │   ├── 📄 AppPages.ts
│   │   │   └── 📄 catalog_fallback.ts
│   │   ├── 📁 services
│   │   │   ├── 📁 ai
│   │   │   │   ├── 📄 AISettingsService.test.ts
│   │   │   │   └── 📄 AISettingsService.ts
│   │   │   ├── 📁 downloads
│   │   │   ├── 📁 modules
│   │   │   │   ├── 📄 ModuleSettingsService.test.ts
│   │   │   │   └── 📄 ModuleSettingsService.ts
│   │   │   ├── 📁 state
│   │   │   │   ├── 📄 UiStateStore.test.ts
│   │   │   │   └── 📄 UiStateStore.ts
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 UISettingsService.test.ts
│   │   │   │   └── 📄 UISettingsService.ts
│   │   │   ├── 📄 CatalogService.test.ts
│   │   │   ├── 📄 CatalogService.ts
│   │   │   ├── 📄 ErrorHandler.test.ts
│   │   │   ├── 📄 ErrorHandler.ts
│   │   │   ├── 📄 EventBus.test.ts
│   │   │   ├── 📄 EventBus.ts
│   │   │   ├── 📄 ModulePlatformService.test.ts
│   │   │   ├── 📄 ModulePlatformService.ts
│   │   │   ├── 📄 ModuleService.test.ts
│   │   │   ├── 📄 ModuleService.ts
│   │   │   ├── 📄 SoundService.test.ts
│   │   │   ├── 📄 SoundService.ts
│   │   │   ├── 📄 TemplateLoader.ts
│   │   │   ├── 📄 WindowService.test.ts
│   │   │   ├── 📄 WindowService.ts
│   │   │   └── 📄 templateLoader.test.ts
│   │   ├── 📁 shell
│   │   │   ├── 📁 ui
│   │   │   │   ├── 📄 ModalManager.test.ts
│   │   │   │   ├── 📄 ModalManager.ts
│   │   │   │   ├── 📄 ModuleCardRenderer.test.ts
│   │   │   │   ├── 📄 ModuleCardRenderer.ts
│   │   │   │   ├── 📄 SkeletonManager.test.ts
│   │   │   │   ├── 📄 SkeletonManager.ts
│   │   │   │   ├── 📄 ToastManager.test.ts
│   │   │   │   └── 📄 ToastManager.ts
│   │   │   ├── 📄 AppUI.test.ts
│   │   │   ├── 📄 AppUI.ts
│   │   │   ├── 📄 Particles.ts
│   │   │   ├── 📄 SidebarUI.ts
│   │   │   ├── 📄 WindowUI.test.ts
│   │   │   └── 📄 WindowUI.ts
│   │   ├── 📁 types
│   │   │   ├── 📄 IBridge.ts
│   │   │   ├── 📄 bindings.ts
│   │   │   ├── 📄 categoryKeys.ts
│   │   │   ├── 📄 coreTypes.ts
│   │   │   ├── 📄 global.d.ts
│   │   │   └── 📄 global_bridge_types.ts
│   │   ├── 📁 ui
│   │   │   ├── 📁 components
│   │   │   │   ├── 📄 ActionButton.ts
│   │   │   │   └── 📄 AsyncView.ts
│   │   │   ├── 📄 BaseComponent.test.ts
│   │   │   ├── 📄 BaseComponent.ts
│   │   │   └── 📄 renderSimpleFeature.ts
│   │   └── 📁 utils
│   │       ├── 📄 globalAccessor.test.ts
│   │       ├── 📄 globalAccessor.ts
│   │       ├── 📄 moduleTypeUtils.test.ts
│   │       └── 📄 moduleTypeUtils.ts
│   ├── 📁 styles
│   │   ├── 📁 base
│   │   │   ├── 🎨 animations.css
│   │   │   ├── 🎨 fonts.css
│   │   │   ├── 🎨 reset.css
│   │   │   ├── 🎨 scrollbar.css
│   │   │   ├── 🎨 splash.css
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
│   │   │   ├── 🎨 finalcheck.css
│   │   │   ├── 🎨 monitoring.css
│   │   │   ├── 🎨 settings.css
│   │   │   ├── 🎨 testfeature.css
│   │   │   └── 🎨 user-preferences.css
│   │   ├── 📁 layouts
│   │   │   ├── 🎨 controls.css
│   │   │   ├── 🎨 main-area.css
│   │   │   ├── 🎨 modals.css
│   │   │   ├── 🎨 sidebar.css
│   │   │   ├── 🎨 splash.css
│   │   │   └── 🎨 toasts.css
│   │   ├── 📁 tokens
│   │   └── 🎨 main.css
│   ├── 📁 test
│   │   ├── 📁 mocks
│   │   │   ├── 📄 mockBridge.ts
│   │   │   └── 📄 mockUiStateStore.ts
│   │   ├── 📄 setup.test.ts
│   │   └── 📄 setup.ts
│   ├── ⚙️ .prettierignore
│   ├── ⚙️ .prettierrc
│   ├── 📄 eslint.config.js
│   ├── 🌐 index.html
│   ├── ⚙️ package-lock.json
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
│   │   │   ├── ⚙️ app.json
│   │   │   └── ⚙️ local_modules.json
│   │   ├── 📁 locales
│   │   │   ├── ⚙️ en.json
│   │   │   ├── ⚙️ ru.json
│   │   │   └── ⚙️ zh.json
│   │   ├── 📁 tools
│   │   └── ⚙️ api_providers.json
│   ├── 📁 src
│   │   ├── 📁 api
│   │   │   ├── 📁 ai
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 engine
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
│   │   ├── 📁 app
│   │   │   ├── 🦀 mod.rs
│   │   │   ├── 🦀 tray.rs
│   │   │   └── 🦀 window.rs
│   │   ├── 📁 domain
│   │   │   ├── 📁 ai
│   │   │   │   ├── 🦀 ai_service.rs
│   │   │   │   ├── 🦀 custom_model_service.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 session.rs
│   │   │   │   ├── 🦀 streaming.rs
│   │   │   │   └── 🦀 types.rs
│   │   │   ├── 📁 engine
│   │   │   │   ├── 🦀 detector.rs
│   │   │   │   ├── 🦀 events.rs
│   │   │   │   ├── 🦀 manager.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 queue.rs
│   │   │   │   ├── 🦀 registry.rs
│   │   │   │   └── 🦀 types.rs
│   │   │   ├── 📁 filesystem
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 service.rs
│   │   │   ├── 📁 license
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 storage.rs
│   │   │   │   ├── 🦀 types.rs
│   │   │   │   └── 🦀 verifier.rs
│   │   │   ├── 📁 modules
│   │   │   │   ├── 📁 controller
│   │   │   │   │   ├── 🦀 lifecycle.rs
│   │   │   │   │   ├── 🦀 mod.rs
│   │   │   │   │   └── 🦀 process.rs
│   │   │   │   ├── 🦀 downloader.rs
│   │   │   │   ├── 🦀 github_releases.rs
│   │   │   │   ├── 🦀 lifecycle.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 monitoring
│   │   │   │   ├── 🦀 gpu_collector.rs
│   │   │   │   ├── 🦀 health.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 system_monitor.rs
│   │   │   ├── 📁 system
│   │   │   │   ├── 🦀 config_repository.rs
│   │   │   │   ├── 🦀 config_service.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 startup.rs
│   │   │   └── 🦀 mod.rs
│   │   ├── 📁 infrastructure
│   │   │   ├── 📁 config
│   │   │   │   ├── 🦀 config_repository.rs
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   ├── 🦀 settings.rs
│   │   │   │   ├── 🦀 theme.rs
│   │   │   │   ├── 🦀 translations.rs
│   │   │   │   ├── 🦀 ui_state.rs
│   │   │   │   └── 🦀 window_settings.rs
│   │   │   ├── 📁 crypto
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 secure_storage.rs
│   │   │   ├── 📁 engine
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 tauri_emitter.rs
│   │   │   ├── 📁 filesystem
│   │   │   │   ├── 🦀 file_service.rs
│   │   │   │   ├── 🦀 local_file_service.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 http
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 server.rs
│   │   │   ├── 📁 logging
│   │   │   │   ├── 🦀 logger.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 persistence
│   │   │   │   ├── 🦀 json_store.rs
│   │   │   │   └── 🦀 mod.rs
│   │   │   ├── 📁 system
│   │   │   │   ├── 🦀 mod.rs
│   │   │   │   └── 🦀 startup.rs
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
│   │   │   └── 🦀 windows.rs
│   │   ├── 🦀 errors.rs
│   │   ├── 🦀 lib.rs
│   │   ├── 🦀 main.rs
│   │   └── 🦀 tests.rs
│   ├── 📁 test_appdata_roaming
│   │   └── 📁 User
│   │       └── 📁 Configs
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

**Key Architectural Takeaways:**
1. Strictly decoupled: Frontend logic NEVER accesses backend implementations directly. All operations pass through `src/shared/api` invoking strictly typed `src-tauri/src/api` Tauri endpoints.
2. Rust `Domain` independence: Business logic (`infrastructure/` & `domain/`) is 100% agnostic to Tauri. It can be easily rewritten to a native UI cleanly.
3. Feature folders: Instead of spreading types, logic, and UI globally across `components/`, everything relies on isolated domains (`features/ai`, `features/monitoring`).
