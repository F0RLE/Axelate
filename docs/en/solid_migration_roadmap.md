# SOLID Migration Checklist

## Backend (Rust / `src-tauri`)

### Domain (Business Logic)
- **AI**
    - [x] `src/domain/ai/ai_service.rs`
    - [x] `src/domain/ai/custom_model_service.rs`
    - [ ] `src/domain/ai/mod.rs`
- **Modules**
    - [x] `src/domain/modules/controller.rs`
    - [x] `src/domain/modules/lifecycle.rs`
    - [x] `src/domain/modules/downloader.rs`
    - [ ] `src/domain/modules/mod.rs`
- **Phase 5: UI/UX Polish** (2026-02-12)
    - [x] Fix sidebar layout spacing when monitoring panel is hidden.
    - [ ] Complete UI consistency audit.
- **Monitoring**
    - [x] `src/domain/monitoring/system_monitor.rs`
    - [ ] `src/domain/monitoring/health.rs`
    - [ ] `src/domain/monitoring/mod.rs`
- **License**
    - [ ] `src/domain/license/verifier.rs`
    - [ ] `src/domain/license/storage.rs`
    - [ ] `src/domain/license/types.rs`
    - [ ] `src/domain/license/mod.rs`
- **Root**
    - [ ] `src/domain/mod.rs`

### API (Interface Adapters)
- **AI**
    - [x] `src/api/ai/mod.rs`
- **License**
    - [ ] `src/api/license/mod.rs`
- **Modules**
    - [ ] `src/api/modules/downloader.rs`
    - [ ] `src/api/modules/mod.rs`
- **Secure**
    - [ ] `src/api/secure/mod.rs`
- **Settings**
    - [ ] `src/api/settings/mod.rs`
    - [ ] `src/api/settings/theme.rs`
    - [ ] `src/api/settings/translations.rs`
    - [ ] `src/api/settings/ui_state.rs`
    - [ ] `src/api/settings/window_settings.rs`
- **System**
    - [ ] `src/api/system/bootstrap.rs`
    - [ ] `src/api/system/config.rs`
    - [ ] `src/api/system/health.rs`
    - [ ] `src/api/system/logs.rs`
    - [ ] `src/api/system/mod.rs`
- **Window**
    - [ ] `src/api/window/mod.rs`
- **Root**
    - [ ] `src/api/mod.rs`

### Infrastructure (Implementation Details)
- **Config**
    - [ ] `src/infrastructure/config/config_service.rs`
    - [ ] `src/infrastructure/config/mod.rs`
    - [ ] `src/infrastructure/config/settings.rs`
    - [ ] `src/infrastructure/config/theme.rs`
    - [ ] `src/infrastructure/config/translations.rs`
    - [ ] `src/infrastructure/config/ui_state.rs`
    - [ ] `src/infrastructure/config/window_settings.rs`
- **Crypto**
    - [ ] `src/infrastructure/crypto/mod.rs`
    - [x] `src/infrastructure/crypto/secure_storage.rs`
- **Filesystem**
    - [ ] `src/infrastructure/filesystem/file_service.rs`
    - [ ] `src/infrastructure/filesystem/mod.rs`
- **Http**
    - [ ] `src/infrastructure/http/mod.rs`
    - [ ] `src/infrastructure/http/server.rs`
- **Logging**
    - [ ] `src/infrastructure/logging/logger.rs`
    - [ ] `src/infrastructure/logging/mod.rs`
- **Root**
    - [ ] `src/infrastructure/mod.rs`

### Models (Core Types)
- [ ] `src/models/config.rs`
- [ ] `src/models/custom_models.rs`
- [ ] `src/models/license.rs`
- [ ] `src/models/mod.rs`
- [ ] `src/models/module.rs`
- [ ] `src/models/modules.rs`
- [ ] `src/models/settings.rs`
- [ ] `src/models/system.rs`
- [ ] `src/models/ui_state.rs`

### Utils
- [ ] `src/utils/memory.rs`
- [ ] `src/utils/mod.rs`
- [x] `src/utils/paths.rs`
- [ ] `src/utils/process.rs`
- [x] `src/utils/setup.rs`
- [ ] `src/utils/windows.rs`

### Core
- [ ] `src/errors.rs`
- [ ] `src/lib.rs`
- [ ] `src/main.rs`
- [ ] `src/tests.rs`
- [-] `build.rs` (Build script - Config)
- [-] `Cargo.lock` (Auto-generated)
- [x] `Cargo.toml` (Config)
- [-] `rustfmt.toml` (Config)
- [x] `tauri.conf.json` (Config)

---

## Resources (Non-Code)
- [-] `src-tauri/capabilities/default.json`
- [-] `src-tauri/icons/*`
- [-] `src-tauri/resources/*`

## Frontend (TypeScript / `src`)
- **Foundational Services (DIP/SOLID)**
    - [x] `src/shared/services/CatalogService.ts`
    - [x] `src/infrastructure/i18n/I18nService.ts`
    [x] Phase 4: Foundation Services SOLID Migration (DIP & SRP)
[/] Phase 5: UI/UX Polish & Layout Fixes
    [x] Investigate Sidebar Layout Spacing issue
    [x] Fix Sidebar Layout Spacing (empty space when monitor hidden)
    [ ] Continuous SOLID Audit for remaining components
[/] Phase 6: Feature Services SOLID Migration
    [ ] MonitoringService Refactoring
    [ ] SettingsService Refactoring
    [ ] NavigationService Refactoring
[ ] Phase 7: Verification & Final Polish
    [ ] Full regression testing
    [ ] Documentation finalization
    - [x] `src/shared/services/ModuleService.ts`
    - [x] `src/shared/services/WindowService.ts`
    - [x] `src/shared/services/StateService.ts`
    - [x] `src/app/init.ts` (Boot Sequence)
- **Feature Services**
    - [ ] `src/shared/services/MonitoringService.ts`
    - [ ] `src/shared/services/SettingsService.ts`
    - [ ] `src/shared/services/NavigationService.ts`
- **Other**
    - [-] `src/assets/*`
    - [-] `src/styles/*`
    - [-] `package.json`

## Documentation & Github
- [-] `.github/*`
- [-] `docs/*`
- [-] `LICENSE`
- [-] `README.md`
- [-] `.gitignore`
