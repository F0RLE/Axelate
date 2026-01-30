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

## 1. Prerequisites

Before starting, ensure you have the following installed:

| Tool | Required Version | Installation |
| :--- | :--- | :--- |
| **Rust** | `1.93.0`+ (Stable) | [rustup.rs](https://rustup.rs/) |
| **Node.js** | `22.x` (LTS) | [nodejs.org](https://nodejs.org/) |
| **pnpm** | `9.x`+ | `npm install -g pnpm` |
| **Visual Studio Build Tools** | 2022+ | Required for Windows Rust compilation |

---

## 2. Installation

### 2.1 Clone Repository

```bash
git clone https://github.com/F0RLE/Axelate.git
cd Axelate
```

### 2.2 Install Dependencies

```bash
# Root dependencies (Tauri CLI, Husky)
npm install

# Frontend dependencies
cd src && npm install
```

### 2.3 Verify Rust Setup

```bash
rustc --version    # Should be 1.93.0+
cargo --version
```

---

## 3. Development Workflow

### 3.1 Launch Dev Server

```bash
# From src/ directory
npm run tauri:dev
```

This will:
1. Start Vite dev server on `http://localhost:1420`
2. Launch Tauri application with hot-reload
3. Open DevTools for frontend debugging

### 3.2 Frontend-Only Development

```bash
cd src
npm run dev    # Vite dev server only (no Tauri)
```

> **Note:** Some features require Tauri (IPC, secure storage). Use mock mode in `TauriProvider.ts`.

### 3.3 Backend-Only Changes

```bash
cd src-tauri
cargo check         # Quick syntax/type check
cargo clippy        # Lint with warnings as errors
cargo build         # Full debug build
```

---

## 4. Project Structure Overview

```
Axelate/
├── src/                       # Frontend (TypeScript + Vite)
│   ├── modules/               # Feature modules
│   │   ├── core/              # Core services (EventBus, State, etc.)
│   │   ├── ai/                # AI Bridge & providers
│   │   ├── chat/              # Chat interface
│   │   ├── settings/          # App settings
│   │   ├── monitoring/        # System monitoring
│   │   └── ...
│   ├── css/                   # Stylesheets (design tokens)
│   ├── templates/             # HTML templates
│   └── test/                  # Vitest tests
├── src-tauri/                 # Backend (Rust + Tauri v2)
│   ├── src/
│   │   ├── commands/          # IPC command handlers
│   │   ├── services/          # Business logic
│   │   ├── models/            # Data structures
│   │   └── utils/             # Helpers
│   └── resources/             # Config files, locales
└── docs/                      # Documentation
```

---

## 5. Debugging

### 5.1 Frontend (DevTools)

- Press `F12` or `Ctrl+Shift+I` to open DevTools
- Console logs use prefixes: `[ModuleName] Message`
- Debug panel available in DEV mode (bottom-right trigger)

### 5.2 Backend (Rust Logs)

```bash
# Set log level
RUST_LOG=debug npm run tauri:dev
```

Log files location: `%APPDATA%/AxelateData/logs/`

### 5.3 IPC Debugging

All IPC calls are logged:
```
[TauriProvider] Invoking: command_name {...args}
[TauriProvider] Invoke success: command_name
```

---

## 6. Testing

### 6.1 Run Frontend Tests

```bash
cd src
npm run test              # Run all tests once
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

### 6.2 Run Backend Tests

```bash
cd src-tauri
cargo test
```

### 6.3 Linting & Formatting

```bash
cd src
npm run lint              # ESLint check
npm run lint:fix          # Auto-fix issues
npm run format            # Prettier format
npm run format:check      # Check formatting
```

---

## 7. Building for Production

### 7.1 Development Build

```bash
npm run tauri:build
```

### 7.2 Release Build

```bash
cd src
npm run release    # Optimized build
```

Output: `src-tauri/target/release/bundle/`

---

## 8. Common Issues

| Issue | Solution |
| :--- | :--- |
| `WebView2 not found` | Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| `cargo build` fails | Run `rustup update` and install Visual Studio Build Tools |
| Port 1420 in use | Kill process or change port in `vite.config.ts` |
| White screen on launch | Check DevTools console for errors |

---

## 9. Useful Links

- **Architecture**: [architecture.md](architecture.md) - Deep dive into core systems
- **Coding Standards**: [CODING_STANDARDS.md](CODING_STANDARDS.md) - Mandatory patterns and quality rules
- **Security Policy**: [SECURITY.md](../../SECURITY.md) - Reporting vulnerabilities
- **Quickstart**: [QUICKSTART.md](QUICKSTART.md) - Fast onboarding guide

---

<div align="center">
  <br>
  <sub>Copyright © 2026 Axelate. All Rights Reserved.</sub>
</div>
