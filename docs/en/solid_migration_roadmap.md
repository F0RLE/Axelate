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
    - [ ] `src/domain/modules/downloader.rs`
    - [ ] `src/domain/modules/mod.rs`
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
    - [ ] `src/infrastructure/crypto/secure_storage.rs`
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
- [ ] `src/utils/paths.rs`
- [ ] `src/utils/process.rs`
- [ ] `src/utils/setup.rs`
- [ ] `src/utils/windows.rs`

### Core
- [ ] `src/errors.rs`
- [ ] `src/lib.rs`
- [ ] `src/main.rs`
- [ ] `src/tests.rs`
- [-] `build.rs` (Build script - Config)
- [-] `Cargo.lock` (Auto-generated)
- [-] `Cargo.toml` (Config)
- [-] `rustfmt.toml` (Config)
- [-] `tauri.conf.json` (Config)

---

## Resources (Non-Code)
- [-] `src-tauri/capabilities/default.json`
- [-] `src-tauri/icons/*`
- [-] `src-tauri/resources/*`

## Frontend (TypeScript / `src`) - Out of Scope for Backend SOLID Refactor
- [-] `src/app/*`
- [-] `src/assets/*`
- [-] `src/features/*`
- [-] `src/infrastructure/*` (Frontend)
- [-] `src/scripts/*`
- [-] `src/shared/*`
- [-] `src/styles/*` (CSS)
- [-] `src/templates/*`
- [-] `src/test/*`
- [-] `src/*.ts` (Config/Env)
- [-] `package.json`
- [-] `.prettierrc`
- [-] `eslint.config.js`
- [-] `index.html`
- [-] `tsconfig.json`
- [-] `vite.config.ts`

## Documentation & Github
- [-] `.github/*`
- [-] `docs/*`
- [-] `LICENSE`
- [-] `README.md`
- [-] `.gitignore`
