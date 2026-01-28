<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Flux Platform Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Flux Platform</h1>
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

## 1. Installation

1.  **Clone Source**
    ```bash
    git clone https://github.com/F0RLE/flux-platform.git
    ```

2.  **Install Dependencies**
    ```bash
    npm install       # Root
    cd src && npm i   # Frontend
    ```

3.  **Launch Dev Environment**
    ```bash
    # From root
    npm run tauri:dev
    ```

---

## 2. Environment Requirements

| Tool | Required Version | Why? |
| :--- | :--- | :--- |
| **Rust** | `1.93.0`+ (Stable) | Memory optimizers and new async features. |
| **Node.js** | `22.x` (LTS) | Native top-level await and ESM stability. |
| **pnpm** | `9.x`+ | Performance and strict hoisting. |

---

## 3. Project Links

*   **Architecture**: [architecture.md](architecture.md) - Deep dive into core systems.
*   **Coding Standards**: [CODING_STANDARDS.md](CODING_STANDARDS.md) - Mandatory patterns and quality rules.
*   **Security Policy**: [SECURITY.md](../../SECURITY.md) - Reporting vulnerabilities.

---

<div align="center">
  <br>
  <sub>Copyright © 2026 Flux Platform. All Rights Reserved.</sub>
</div>
