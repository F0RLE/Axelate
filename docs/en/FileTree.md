\# File Tree: Axelate



\*\*Generated:\*\* 2/6/2026, 6:10:45 PM

\*\*Root Path:\*\* `c:\\Users\\FORLE\\Desktop\\Axelate`



```

├── 📁 .github

│   ├── 📁 .husky

│   │   ├── 📄 commit-msg

│   │   └── 📄 pre-commit

│   ├── 📁 ISSUE\_TEMPLATE

│   │   ├── 📝 bug\_report.md

│   │   └── 📝 feature\_request.md

│   ├── 📁 scripts

│   │   ├── 📄 clear.ps1

│   │   ├── 📄 dev.ps1

│   │   ├── 📄 release.ps1

│   │   ├── 📄 update.ps1

│   │   └── 📄 verify-all.ps1

│   ├── 📁 workflows

│   │   ├── ⚙️ ci.yml

│   │   └── ⚙️ release.yml

│   ├── 📝 PULL\_REQUEST\_TEMPLATE.md

│   ├── 📄 commitlint.config.js

│   └── ⚙️ dependabot.yml

├── 📁 docs

│   └── 📁 en

│       ├── 📝 CODING\_STANDARDS.md

│       ├── 📝 architecture.md

│       └── 📝 getting-started.md

├── 📁 src

│   ├── 📁 assets

│   │   ├── 📁 fonts

│   │   │   ├── 📄 Cubic\_11.ttf

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

│   │   │   │   └── 📄 AIProvider.ts

│   │   │   ├── 📁 types

│   │   │   │   └── 📄 aiTypes.ts

│   │   │   ├── 📁 ui

│   │   │   │   └── 📄 AISettingsRenderer.ts

│   │   │   ├── 📁 utils

│   │   │   │   └── 📄 catalogHelpers.ts

│   │   │   ├── 📄 AIBridge.ts

│   │   │   └── 📄 index.ts

│   │   ├── 📁 chat

│   │   │   ├── 📁 services

│   │   │   │   ├── 📄 ChatFileHandler.ts

│   │   │   │   ├── 📄 ChatService.ts

│   │   │   │   └── 📄 VoiceInputService.ts

│   │   │   ├── 📁 types

│   │   │   │   └── 📄 chatTypes.ts

│   │   │   ├── 📁 ui

│   │   │   │   └── 📄 ChatUI.ts

│   │   │   ├── 📁 utils

│   │   │   │   └── 📄 chatUtils.ts

│   │   │   ├── 📄 chat.ts

│   │   │   └── 📄 index.ts

│   │   ├── 📁 core

│   │   │   ├── 📁 boot

│   │   │   │   ├── 📄 EventHandler.ts

│   │   │   │   └── 📄 GlobalBridge.ts

│   │   │   ├── 📁 services

│   │   │   │   ├── 📄 CatalogService.ts

│   │   │   │   ├── 📄 ErrorHandler.ts

│   │   │   │   ├── 📄 EventBus.ts

│   │   │   │   ├── 📄 I18nService.ts

│   │   │   │   ├── 📄 LoggerService.ts

│   │   │   │   ├── 📄 ModuleService.ts

│   │   │   │   ├── 📄 NavigationService.ts

│   │   │   │   ├── 📄 SoundService.ts

│   │   │   │   ├── 📄 StateService.ts

│   │   │   │   ├── 📄 TauriProvider.ts

│   │   │   │   ├── 📄 TemplateLoader.ts

│   │   │   │   └── 📄 WindowService.ts

│   │   │   ├── 📁 types

│   │   │   │   └── 📄 coreTypes.ts

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

│   │   │   │   └── 📄 DashboardUI.ts

│   │   │   └── 📄 index.ts

│   │   ├── 📁 debug

│   │   │   ├── 📁 services

│   │   │   │   └── 📄 DebugService.ts

│   │   │   ├── 📁 ui

│   │   │   │   └── 📄 DebugUI.ts

│   │   │   └── 📄 index.ts

│   │   ├── 📁 downloader

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

│   │       │   ├── 📄 GeneralSettingsRenderer.ts

│   │       │   └── 📄 SettingsUI.ts

│   │       └── 📄 index.ts

│   ├── 📁 public

│   │   └── 📁 templates

│   │       ├── 📁 components

│   │       │   └── 🌐 sidebar.html

│   │       ├── 📁 modals

│   │       └── 📁 pages

│   │           └── 🌐 settings.html

│   ├── 📁 scripts

│   │   ├── 📄 bump-version.js

│   │   └── 📄 check-size.js

│   ├── 📁 test

│   │   ├── 📄 AIBridge.test.ts

│   │   ├── 📄 ChatFileHandler.test.ts

│   │   ├── 📄 ErrorHandler.test.ts

│   │   ├── 📄 EventBus.test.ts

│   │   ├── 📄 I18nService.test.ts

│   │   ├── 📄 ModuleService.test.ts

│   │   ├── 📄 NavigationService.test.ts

│   │   ├── 📄 StateService.test.ts

│   │   ├── 📄 TauriProvider.test.ts

│   │   ├── 📄 VoiceInputService.test.ts

│   │   ├── 📄 setup.test.ts

│   │   ├── 📄 setup.ts

│   │   └── 📄 templateLoader.test.ts

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

│   │   └── ⚙️ api\_providers.json

│   ├── 📁 src

│   │   ├── 📁 commands

│   │   │   ├── 🦀 ai.rs

│   │   │   ├── 🦀 bootstrap.rs

│   │   │   ├── 🦀 config.rs

│   │   │   ├── 🦀 downloader.rs

│   │   │   ├── 🦀 health.rs

│   │   │   ├── 🦀 license.rs

│   │   │   ├── 🦀 logs.rs

│   │   │   ├── 🦀 mod.rs

│   │   │   ├── 🦀 modules.rs

│   │   │   ├── 🦀 secure.rs

│   │   │   ├── 🦀 settings.rs

│   │   │   ├── 🦀 system.rs

│   │   │   ├── 🦀 theme.rs

│   │   │   ├── 🦀 translations.rs

│   │   │   ├── 🦀 ui\_state.rs

│   │   │   ├── 🦀 window.rs

│   │   │   └── 🦀 window\_settings.rs

│   │   ├── 📁 models

│   │   │   ├── 🦀 config.rs

│   │   │   ├── 🦀 custom\_models.rs

│   │   │   ├── 🦀 license.rs

│   │   │   ├── 🦀 mod.rs

│   │   │   ├── 🦀 module.rs

│   │   │   ├── 🦀 modules.rs

│   │   │   ├── 🦀 settings.rs

│   │   │   ├── 🦀 system.rs

│   │   │   └── 🦀 ui\_state.rs

│   │   ├── 📁 services

│   │   │   ├── 📁 license

│   │   │   │   ├── 🦀 mod.rs

│   │   │   │   ├── 🦀 storage.rs

│   │   │   │   ├── 🦀 types.rs

│   │   │   │   └── 🦀 verifier.rs

│   │   │   ├── 🦀 ai\_service.rs

│   │   │   ├── 🦀 config\_service.rs

│   │   │   ├── 🦀 custom\_model\_service.rs

│   │   │   ├── 🦀 downloader.rs

│   │   │   ├── 🦀 file\_service.rs

│   │   │   ├── 🦀 health.rs

│   │   │   ├── 🦀 logs.rs

│   │   │   ├── 🦀 mod.rs

│   │   │   ├── 🦀 module\_controller.rs

│   │   │   ├── 🦀 module\_lifecycle.rs

│   │   │   ├── 🦀 secure\_storage.rs

│   │   │   ├── 🦀 server.rs

│   │   │   ├── 🦀 settings.rs

│   │   │   ├── 🦀 system\_monitor.rs

│   │   │   ├── 🦀 theme.rs

│   │   │   ├── 🦀 translations.rs

│   │   │   ├── 🦀 ui\_state.rs

│   │   │   └── 🦀 window\_settings.rs

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

│   ├── ⚙️ Cargo.toml

│   ├── 🦀 build.rs

│   ├── ⚙️ rustfmt.toml

│   └── ⚙️ tauri.conf.json

├── ⚙️ .editorconfig

├── ⚙️ .gitattributes

├── ⚙️ .gitignore

├── ⚙️ .prettierignore

├── 📝 CODE\_OF\_CONDUCT.md

├── 📝 CONTRIBUTING.md

├── 📄 LICENSE

├── 📝 README.md

├── 📝 SECURITY.md

└── ⚙️ package.json

```



---

\*Generated by FileTree Pro Extension\*

