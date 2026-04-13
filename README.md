<div align="center">
  <br />
  <img src="src-tauri/icons/icon.png" alt="Axelate Logo" width="160" height="160" />
  <br />

  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">The Secure Environment for AI Workflows</p>

  <br />

  <a href="https://github.com/F0RLE/Axelate/releases">
    <img src="https://img.shields.io/badge/Download_Axelate-007AFF?style=for-the-badge&logo=windows&logoColor=white" height="40" alt="Download Now" />
  </a>

  <br />
  <br />

  <p>
    <a href="docs/ru/VISION.md"><img src="https://img.shields.io/badge/Russian-31303a?style=for-the-badge&logo=google-translate&logoColor=white" height="30" alt="Russian"/></a>
    &nbsp;
    <a href="docs/zh/README_CN.md"><img src="https://img.shields.io/badge/Chinese-31303a?style=for-the-badge&logo=google-translate&logoColor=white" height="30" alt="Chinese"/></a>
    &nbsp;
    <a href="docs/en/architecture.md"><img src="https://img.shields.io/badge/Documentation-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Docs"/></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Status-Public_Beta-orange?style=for-the-badge" height="30" alt="Status: Beta"/>
  </p>

  <br />
</div>

> [!IMPORTANT]
> Axelate is currently in public beta.
>
> This is pre-release software. Features may change, and current workflows are still being hardened.

---

<div align="center">

## Experience the Future

**Axelate** is a dedicated desktop workspace for AI workflows.
<br>Built for those who care about **privacy**, **speed**, and **control**.

</div>

<br>

<div align="center">

| Secure Local Storage | Native Desktop Runtime | Local Engine Management |
| :---: | :---: | :---: |
| Sensitive values are stored locally and handled on the backend side. | Powered by **Rust**, **Tauri v2**, and **vanilla TypeScript**. | Install and run `llama.cpp` and `stable-diffusion.cpp` with hardware-aware release selection. |

</div>

---

<h2 align="center">Getting Started</h2>

<div align="center">

<p>
  <b>1. Download</b> the installer from the <a href="https://github.com/F0RLE/Axelate/releases">Releases Page</a>.
  <br>
  <b>2. Run</b> `Axelate Setup.exe`.
  <br>
  <b>3. Open</b> Settings, add your OpenRouter key, then install local modules if needed.
</p>

</div>

---

<h2 align="center">For Developers</h2>

Axelate uses Rust for domain logic and a thin TypeScript shell for the desktop UI.

<div align="center">

[![Getting Started](https://img.shields.io/badge/📖_Getting_Started-Read-31303a?style=flat-square)](docs/en/getting-started.md)
[![Architecture Spec](https://img.shields.io/badge/🏗️_Architecture_Spec-Deep_Dive-31303a?style=flat-square)](docs/en/architecture.md)
[![Automation](https://img.shields.io/badge/⚙️_Automation-Read-31303a?style=flat-square)](docs/en/AUTOMATION.md)
[![Coding Standards](https://img.shields.io/badge/🧭_Coding_Standards-Read-31303a?style=flat-square)](docs/en/CODING_STANDARDS.md)

</div>

### Current repository layout

```text
Axelate/
├── src/         frontend app and npm dependencies
├── src-tauri/   Rust backend and Tauri configuration
├── scripts/     shared cross-platform workflow runner
├── launchers/   optional double-click entrypoints by platform
├── docs/        project documentation
└── .github/     workflows, templates, legacy PowerShell helpers
```

`src/` is the only npm project with real dependencies. The root `package.json` only proxies commands.

### Common commands

```bash
npm run install-deps
npm run dev
npm run dev:webview
npm run dev:inspect
npm run dev:release-like
npm run verify
npm run build
npm run test
```

`npm run dev`, `npm run dev:webview`, `npm run dev:app`, and `npm run tauri:dev` start the frontend inside the Tauri desktop WebView with Rust IPC enabled.
`npm run dev:inspect` also opens desktop DevTools and enables WebView remote debugging on port `9223` for automation tools.
`npm run dev:release-like` rebuilds the frontend and starts Tauri against the built static assets without Vite HMR.
Use `launchers/*/dev-app.*` for desktop runtime checks and `launchers/*/dev-inspect.*` when you want deep inspection.
Use `launchers/*/dev-release-like.*` when you want a closer-to-release desktop smoke test.

On Windows, install WebView2 Runtime, Windows SDK, and Microsoft C++ Build Tools first.
Portable Node/Rust toolchains are supported through `AXELATE_DEPS_DIR`, `./.deps`, or `%USERPROFILE%/Axelate-deps`.
Double-click launchers are grouped under `launchers/windows`, `launchers/macos`, and `launchers/linux`.
Release packaging uses the same Windows prerequisites and will only pass after `npm run verify` is green.

### Current product scope

Today Axelate is:

- a launcher for local AI engines
- an API-backed AI chat shell
- a unified desktop UI for downloads, settings, monitoring, and console tooling

The `Marketplace` page already exists in the UI shell, but marketplace purchase, entitlement, and managed remote execution are still roadmap work.

### More docs

- [Getting Started](docs/en/getting-started.md)
- [Architecture](docs/en/architecture.md)
- [Roadmap](docs/en/ROADMAP.md)
- [Automation](docs/en/AUTOMATION.md)
- [Security Hardening](docs/en/SECURITY_HARDENING.md)

---

<div align="center">

<br>

  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Report_Bug-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Report Bug" /></a>
  &nbsp;
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Request_Feature-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Request Feature" /></a>
  &nbsp;
  <a href=".github/SECURITY.md"><img src="https://img.shields.io/badge/Security_Policy-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Security Policy" /></a>

<br>
<br>

<img src="https://img.shields.io/badge/Made_with_Axelate-31303a?style=flat-square" alt="Made with Axelate" />

<sub>Copyright © 2026 Axelate. All Rights Reserved.</sub>

</div>
