# SOLID Migration Checklist

## Backend (Rust / `src-tauri`)

### Domain (Business Logic)
- **AI**
    - [x] `src/domain/ai/ai_service.rs`
    - [x] `src/domain/ai/custom_model_service.rs`
    - [x] `src/domain/ai/mod.rs`
- **Modules**
    - [x] `src/domain/modules/controller.rs`
    - [x] `src/domain/modules/lifecycle.rs`
    - [x] `src/domain/modules/downloader.rs`
    - [x] `src/domain/modules/mod.rs`
- **Monitoring**
    - [x] `src/domain/monitoring/system_monitor.rs`
    - [x] `src/domain/monitoring/health.rs`
    - [x] `src/domain/monitoring/mod.rs`
- **License**
    - [x] `src/domain/license/verifier.rs`
    - [x] `src/domain/license/storage.rs`
    - [x] `src/domain/license/types.rs`
    - [x] `src/domain/license/mod.rs`
- **Root**
    - [x] `src/domain/mod.rs`

### API (Interface Adapters)
- **AI**
    - [x] `src/api/ai/mod.rs`
- **License**
    - [x] `src/api/license/mod.rs`
- **Modules**
    - [x] `src/api/modules/downloader.rs`
    - [x] `src/api/modules/mod.rs`
- **Secure**
    - [x] `src/api/secure/mod.rs`
- **Settings**
    - [x] `src/api/settings/mod.rs`
    - [x] `src/api/settings/theme.rs`
    - [x] `src/api/settings/translations.rs`
    - [x] `src/api/settings/ui_state.rs`
    - [x] `src/api/settings/window_settings.rs`
- **System**
    - [x] `src/api/system/bootstrap.rs`
    - [x] `src/api/system/config.rs`
    - [x] `src/api/system/health.rs`
    - [x] `src/api/system/logs.rs`
    - [x] `src/api/system/mod.rs`
- **Window**
    - [x] `src/api/window/mod.rs`
- **Root**
    - [x] `src/api/mod.rs`

### Infrastructure (Implementation Details)
- **Config**
    - [x] `src/infrastructure/config/config_repository.rs`
    - [x] `src/infrastructure/config/mod.rs`
    - [x] `src/infrastructure/config/settings.rs`
    - [x] `src/infrastructure/config/theme.rs`
    - [x] `src/infrastructure/config/translations.rs`
    - [x] `src/infrastructure/config/ui_state.rs`
    - [x] `src/infrastructure/config/window_settings.rs`
- **Crypto**
    - [x] `src/infrastructure/crypto/mod.rs`
    - [x] `src/infrastructure/crypto/secure_storage.rs`
- **Filesystem**
    - [x] `src/infrastructure/filesystem/file_service.rs`
    - [x] `src/infrastructure/filesystem/mod.rs`
- **Http**
    - [x] `src/infrastructure/http/mod.rs`
    - [x] `src/infrastructure/http/server.rs`
- **Logging**
    - [x] `src/infrastructure/logging/logger.rs`
    - [x] `src/infrastructure/logging/mod.rs`
- **Root**
    - [x] `src/infrastructure/mod.rs`

### Models (Core Types)
- [x] `src/models/config.rs`
- [x] `src/models/custom_models.rs`
- [x] `src/models/license.rs`
- [x] `src/models/mod.rs`
- [-] `src/models/module.rs` (Dead code — shadowed by `modules.rs`)
- [x] `src/models/modules.rs`
- [x] `src/models/settings.rs`
- [x] `src/models/system.rs`
- [x] `src/models/ui_state.rs`

### Utils
- [x] `src/utils/memory.rs`
- [x] `src/utils/mod.rs`
- [x] `src/utils/paths.rs`
- [x] `src/utils/process.rs`
- [x] `src/utils/windows.rs`

### Core
- [x] `src/errors.rs`
- [x] `src/lib.rs`
- [x] `src/main.rs`
- [x] `src/tests.rs`
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
    - [x] `src/shared/services/ModuleService.ts`
    - [x] `src/shared/services/WindowService.ts`
    - [x] `src/shared/services/StateService.ts`
    - [x] `src/app/init.ts` (Boot Sequence)
- **Phase 4: Foundation Services SOLID Migration (DIP & SRP)**
    - [x] Complete
- **Phase 5: UI/UX Polish & Layout Fixes**
    - [x] Fix sidebar layout spacing when monitoring panel is hidden
    - [x] Complete SOLID audit of all frontend files
    - Remaining DIP violations (future):
        - [ ] `src/features/chat/services/ChatService.ts` — uses `globalThis as TGlobalWin` for aiBridge
        - [ ] `src/features/debug/services/DebugService.ts` — uses `globalThis.__TAURI__` directly
        - [ ] `src/features/downloads/ui/DownloadUI.ts` — uses `globalThis` for settings
- **Phase 6: Feature Services SOLID Migration**
    - [x] `src/features/monitoring/services/MonitoringService.ts`
    - [x] `src/features/settings/services/SettingsService.ts`
    - [x] `src/infrastructure/navigation/NavigationService.ts`
- **Phase 7: Verification & Final Polish**
    - [x] Full build verification (`npm run build` ✅)
    - [x] Documentation finalization (CODING_STANDARDS.md rewritten)
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
