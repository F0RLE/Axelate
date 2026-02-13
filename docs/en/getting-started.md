<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Axelate Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Getting Started</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Home-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="architecture.md"><img src="https://img.shields.io/badge/Architecture-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Architecture"/></a>
    &nbsp;
    <a href="CODING_STANDARDS.md"><img src="https://img.shields.io/badge/Standards-31303a?style=for-the-badge&logo=eslint&logoColor=white" height="30" alt="Standards"/></a>
  </p>
  <br />
</div>

---

## What is Axelate?

**Axelate** is a secure desktop environment for next-generation AI agents. It provides:

- 🛡️ **Hardware-Bound Security** — AES-256-GCM encryption tied to your motherboard
- ⚡ **Native Performance** — Rust kernel + V8 shell, instant startup
- 🧩 **Isolated Modules** — Run AI tools without cross-contamination

---

## Quick Install (Users)

1. **Download** the installer from [Releases](https://github.com/F0RLE/Axelate/releases)
2. **Run** `Axelate Setup.exe`
3. **Launch** Axelate from Start Menu or Desktop

### First Launch

1. Go to **Settings** → **AI Providers**
2. Select a provider (OpenAI GPT, Google Gemini)
3. Enter your API key (stored securely via OS keychain)
4. Click **Save**

---

## Developer Setup

### Prerequisites

| Tool | Required Version | Installation |
| :--- | :--- | :--- |
| **Rust** | `1.93.0`+ (Stable) | [rustup.rs](https://rustup.rs/) |
| **Node.js** | `20.x`+ (LTS) | [nodejs.org](https://nodejs.org/) |
| **npm** | `10.x`+ | Bundled with Node.js |
| **Visual Studio Build Tools** | 2022+ | Required for Windows Rust compilation |

### Installation

```bash
# Clone repository
git clone https://github.com/F0RLE/Axelate.git
cd Axelate

# Install dependencies
npm install
cd src && npm install
```

### Launch Dev Server

```bash
cd src
npm run tauri:dev
```

This will:
1. Start Vite dev server on `http://localhost:1420`
2. Compile Rust backend
3. Launch Tauri application with hot-reload

---

## Project Structure

```
Axelate/
├── src/                           # Frontend (TypeScript + Vite)
│   ├── app/                       # Boot sequence (init, router, events, bridge)
│   ├── features/                  # Feature modules
│   │   ├── ai/                    # AI Bridge & providers
│   │   ├── chat/                  # Chat interface
│   │   ├── settings/              # App settings
│   │   └── monitoring/            # System monitoring
│   ├── shared/                    # Cross-feature services, components, types
│   │   ├── services/              # EventBus, StateService, LoggerService, ...
│   │   ├── components/            # AppUI, SidebarUI, WindowUI
│   │   └── types/                 # bindings.ts (auto-generated), coreTypes.ts
│   ├── infrastructure/            # Technical adapters
│   │   ├── tauri/                 # TauriProvider (IPC abstraction)
│   │   ├── i18n/                  # I18nService + I18nUI
│   │   └── navigation/           # NavigationService + NavigationUI
│   └── styles/                    # CSS (design tokens, BEM components)
│
├── src-tauri/                     # Backend (Rust + Tauri v2)
│   └── src/
│       ├── api/                   # Tauri command adapters (thin, no logic)
│       ├── domain/                # Business logic (ai/, modules/, monitoring/)
│       ├── infrastructure/        # Config, crypto, HTTP, logging
│       ├── models/                # Shared data structures
│       └── utils/                 # Helper functions
│
└── docs/                          # Documentation (en/, ru/)
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Core** | Central orchestrator (`src/app/init.ts`) — wires all services via constructor DI |
| **EventBus** | Type-safe pub/sub for inter-module communication (`shared/services/EventBus.ts`) |
| **StateService** | Persistent UI state via Tauri IPC (backend-first) |
| **AIBridge** | Routes messages to AI providers (GPT, Gemini) via streaming |
| **TauriProvider** | Abstraction layer for Tauri IPC with mock support for testing |
| **BaseComponent** | Abstract UI class with lifecycle (`init`/`destroy`), AbortController cleanup |

---

## Development Commands

| Command | Description |
| :--- | :--- |
| `npm run tauri:dev` | Full Tauri dev mode (frontend + Rust backend) |
| `npm run dev` | Vite only (no Tauri — frontend development) |
| `npm run build` | `tsc && vite build` — type-check + production bundle |
| `npm run tauri:build` | Production Tauri build |
| `npm run release` | Full pipeline: format → typecheck → lint → test → build → tauri build |
| `npm run test` | Run all tests (Vitest) |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier auto-format |
| `npm run typecheck` | `tsc --noEmit` type-check only |

All commands run from project root. Root `package.json` proxies to `src/`.

---

## Debugging

### Frontend (DevTools)
- Press `F12` or `Ctrl+Shift+I` to open DevTools
- Console logs use prefixes: `[ModuleName] Message`

### Backend (Rust Logs)
```bash
RUST_LOG=debug npm run tauri:dev
```
Log files: `%APPDATA%/AxelateData/logs/`

---

## Common Issues

| Issue | Solution |
| :--- | :--- |
| `WebView2 not found` | Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| `cargo build` fails | Run `rustup update` and install Visual Studio Build Tools |
| Port 1420 in use | Kill process or change port in `vite.config.ts` and `tauri.conf.json` |
| White screen | Check DevTools console for errors |

---

## Useful Links

- [Architecture Spec](architecture.md)
- [Coding Standards](CODING_STANDARDS.md)
- [File Tree](FileTree.md)
- [Security Policy](../../SECURITY.md)
- [Contributing](../../CONTRIBUTING.md)

---

<div align="center">
  <br>
  <sub>Copyright © 2026 Axelate. All Rights Reserved.</sub>
</div>
