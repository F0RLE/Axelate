<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Flux Platform Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Flux Platform</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Developer Cookbook</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Home-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="architecture.md"><img src="https://img.shields.io/badge/Documentation-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Docs"/></a>
  </p>
  <br />
</div>

---

---

## Version 0.1.1 (Public Beta)

> **Proprietary Notice**<br>This documentation is confidential and subject to the Flux Platform EULA. Unauthorized distribution is prohibited.

---

## 1. Getting Started

### Installation

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

## 2. Environment Setup (Strict)

| Tool | Required Version | Why? |
| :--- | :--- | :--- |
| **Rust** | `1.92.0`+ (Stable) | Memory optimizers and new async features. |
| **Node.js** | `22.x` (LTS) | Native top-level await and ESM stability. |
| **pnpm** | `9.x`+ | Performance and strict hoisting. |

---

```typescript
export class MyFeatureService {
    private static instance: MyFeatureService;
    private constructor() {}

    public static getInstance() {
        if (!this.instance) this.instance = new MyFeatureService();
        return this.instance;
    }
}
```

---

## 4. Event-Driven IPC Pattern

For long-running tasks (like downloads), use Tauri events instead of polling.

1. **Backend**: Emit events via `app.emit("event_name", payload)`.
2. **Frontend Service**: Listen in the constructor and broadcast via `globalThis.dispatchEvent`.
3. **UI Components**: Listen to the DOM event and update state.

*Example: See `ModuleService.ts` and `download_progress` event.*

---

## 5. Event System & IPC

We use a strictly typed event system. Do not use legacy global handlers.

*   **Core Handler**: `src/modules/core/services/EventBus.ts` (Singleton `eventBus`).
*   **Dispatch**: Use `eventBus.emit('name', { detail })`.
*   **Listen**: Use `eventBus.on('name', callback)`.

### Legacy Migration
*   ❌ `src/js/event-handlers.js` has been **removed**.
*   ✅ Use `src/modules` components for all new logic.


---

## 6. Localization (I18n)

* **Backend**: `translations.rs` loads JSON files from `resources/locales/`.
* **Frontend**: `I18nService` caches translations and exposes `t(key)`.

---

<div align="center">
  <br>
  <a href="https://github.com/F0RLE/flux-platform/issues"><img src="https://img.shields.io/badge/Report_Bug-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Report Bug" /></a>
  &nbsp;
  <a href="https://github.com/F0RLE/flux-platform/issues"><img src="https://img.shields.io/badge/Request_Feature-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Request Feature" /></a>
  &nbsp;
  <a href="../../SECURITY.md"><img src="https://img.shields.io/badge/Security_Policy-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Security Policy" /></a>
  <br>
  <br>
  <img src="https://img.shields.io/badge/Made_with_❤️_by_Flux_Team-31303a?style=flat-square" alt="Made with Love" />
  <br>
  <sub>Copyright © 2026 Flux Platform. All Rights Reserved.</sub>
</div>
