<div align="center">
  <br />
  <img src="src-tauri/icons/icon.png" alt="Axelate Logo" width="160" height="160" />
  <br />

  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Windows-first AI Workstation</p>

  <br />

  <a href="https://github.com/F0RLE/Axelate/releases">
    <img src="https://img.shields.io/badge/Download_Axelate-007AFF?style=for-the-badge&logo=windows&logoColor=white" height="40" alt="Download Axelate" />
  </a>

  <br />
  <br />

  <p>
    <img src="https://img.shields.io/badge/Status-Active_Development-orange?style=for-the-badge" height="30" alt="Status: Active Development"/>
    &nbsp;
    <img src="https://img.shields.io/badge/License-Apache--2.0-1f6feb?style=for-the-badge" height="30" alt="License: Apache 2.0"/>
  </p>

  <br />
</div>

Axelate is currently a Windows-first desktop workstation for local AI runtimes, BYOK cloud models centered on OpenRouter, and one-shell access to logs, downloads, monitoring, settings, and runtime control.

It already includes:

- Rust + Tauri desktop backend
- vanilla TypeScript frontend
- streaming chat and persisted sessions
- OpenRouter-backed text and image flows
- local runtime and module lifecycle management
- downloads, console, monitoring, and settings surfaces
- backend-owned secure state

It is not yet a finished marketplace, managed platform, or polished MCP-first operating layer.

## Preview

![Axelate Launcher Preview](docs/assets/screenshots/Launcher.png)

![Axelate Settings Preview](docs/assets/screenshots/Settings.png)

## Quick Start

Install on Windows first:

- Node.js 20+
- npm 10+
- Rust stable
- WebView2 Runtime
- Windows SDK
- Microsoft C++ Build Tools with the `Desktop development with C++` workload

Then from the repository root:

```bash
npm run setup
npm run dev
```

The root `package.json` is a task runner. Frontend dependencies live in `src/node_modules`, not in a separate root `node_modules` tree.

Useful commands:

```bash
npm run doctor
npm run build
npm run tauri:build
npm run test
npm run typecheck
npm run lint
npm run verify
```

## Docs

Start here:

- [Getting Started](docs/en/GETTING_STARTED.md)
- [Development Workflow](docs/en/DEVELOPMENT_WORKFLOW.md)
- [Current State](docs/en/CURRENT_STATE.md)
- [Contributing](CONTRIBUTING.md)

Current reference:

- [Trust Model](docs/en/TRUST_MODEL.md)

Planning only:

- [Vision](docs/en/VISION.md)
- [Roadmap](docs/en/ROADMAP.md)

`Vision` and `Roadmap` are planning documents. They are not setup guides and should not be read as a promise that those features already ship today.

## Feedback

<div align="center">
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Report_Bug-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Report Bug" /></a>
  &nbsp;
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Request_Feature-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Request Feature" /></a>
</div>
