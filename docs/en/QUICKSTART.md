<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Axelate Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Quickstart Guide</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Home-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="development.md"><img src="https://img.shields.io/badge/Development-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Development"/></a>
    &nbsp;
    <a href="architecture.md"><img src="https://img.shields.io/badge/Architecture-31303a?style=for-the-badge&logo=blueprint&logoColor=white" height="30" alt="Architecture"/></a>
  </p>
  <br />
</div>

---

# Axelate Quickstart Guide

> Get up and running with Axelate in under 5 minutes.

## What is Axelate?

**Axelate** is a secure desktop environment for next-generation AI agents. It provides:

- 🛡️ **Hardware-Bound Security** — AES-256-GCM encryption tied to your motherboard
- ⚡ **Native Performance** — Rust kernel + V8 shell, instant startup
- 🧩 **Isolated Modules** — Run AI tools without cross-contamination

---

## Quick Install

1. **Download** the installer from [Releases](https://github.com/F0RLE/Axelate/releases)
2. **Run** `Axelate Setup.exe`
3. **Launch** Axelate from Start Menu or Desktop

---

## First Launch

### 1. Configure an AI Provider

1. Go to **Settings** → **AI Providers**
2. Select a provider (OpenAI GPT, Google Gemini)
3. Enter your API key (stored securely via OS keychain)
4. Click **Save**

### 2. Start a Chat Session

1. Click **Chat** in the sidebar
2. Select your AI provider from the dropdown
3. Type your message and press Enter

### 3. Monitor System Resources

The **Monitoring** panel shows real-time CPU, RAM, GPU, and Disk usage.

---

## Project Structure (For Developers)

```
Axelate/
├── src/                    # Frontend (Vanilla TypeScript)
│   ├── modules/            # Feature modules (core, ai, chat, settings...)
│   ├── css/                # Stylesheets (design tokens, components)
│   └── templates/          # HTML templates
├── src-tauri/              # Backend (Rust + Tauri v2)
│   ├── src/commands/       # IPC command handlers
│   ├── src/services/       # Business logic
│   └── src/models/         # Data structures
└── docs/                   # Documentation
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Core** | Central orchestrator (`src/modules/core/core.ts`) managing all services |
| **EventBus** | Type-safe pub/sub for inter-module communication |
| **StateService** | Persistent UI state (backend-first, localStorage fallback) |
| **AIBridge** | Singleton routing messages to AI providers (GPT/Gemini) |
| **TauriProvider** | Abstraction layer for Tauri IPC with mock support |

---

## Development Commands

```bash
# Start development server
cd src && npm run tauri:dev

# Run tests
npm run test

# Lint & Format
npm run lint && npm run format

# Build for production
npm run tauri:build
```

---

## Useful Links

- [Architecture Spec](architecture.md)
- [Development Guide](development.md)
- [Coding Standards](CODING_STANDARDS.md)
- [Contributing Guidelines](../../CONTRIBUTING.md)

---

<div align="center">

**Ready to build?** Check out the [Development Guide](development.md) →

</div>
