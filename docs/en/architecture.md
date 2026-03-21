<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Axelate Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Architecture Specification</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Home-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="getting-started.md"><img src="https://img.shields.io/badge/Getting_Started-31303a?style=for-the-badge&logo=rocket&logoColor=white" height="30" alt="Getting Started"/></a>
    &nbsp;
    <a href="CODING_STANDARDS.md"><img src="https://img.shields.io/badge/Standards-31303a?style=for-the-badge&logo=eslint&logoColor=white" height="30" alt="Standards"/></a>
  </p>
  <br />
</div>

---

## Version 0.1.5 (Active Development)

> **Proprietary Notice**<br>This document contains deep internal details of the Axelate architecture. Intended for Core Engineers. Unauthorized distribution is prohibited.

---

## 1. Core Engineering Pillars

### 1.1 Hybrid Kernel Architecture

Axelate is built as a **Hybrid Kernel** application.
*Full engineering standards, compiler configs, and dependency rules: [CODING_STANDARDS.md](CODING_STANDARDS.md).*

* **Kernel (Rust)**: Direct I/O, encryption, process management. All business logic lives here.
* **Shell (TS)**: Stateless visualization layer. No direct file I/O — all data via IPC.

### 1.2 The "Pass-Through" IPC Pattern

Frontend requests map directly to Rust services via thin Tauri command adapters — no middleware layer.

```
Frontend → TauriProvider.invoke() → [IPC] → api/ adapter → domain/ service → Result<T>
```

---

## 2. Low-Level Security Specification

### 2.1 Hardware-Bound Encryption (HBE)

Sensitive data (API Keys, OAuth Tokens) is encrypted using a key derived from the physical hardware.

**Algorithm:**

1. **Entropy Source A**: `machine_uid::get()` (Motherboard Serial / BIOS UUID).
2. **Entropy Source B**: Static Salt `const SALT = "AXELATE_SECURE_SALT_"` (Compiled into binary).
3. **Key Derivation Function (KDF)**: `SHA256(Source A + SALT + Source A)` → 32-byte Key.
4. **Encryption**: `AES-256-GCM` (Galois/Counter Mode).
    * **Nonce**: Random 96-bit per write.
    * **Tag**: 128-bit authentication tag appended to ciphertext.

**File Location:** `%APPDATA%/AxelateData/User/Configs/secure.enc` (HBE-protected)

### 2.2 Memory Hygiene

* **Zero-Trace**: Decrypted keys exist in RAM *only* during the active HTTP request lifecycle and are dropped immediately via Rust's `Drop` trait.
* **No Swap**: Secrets are never written to disk logs or temporary cache files.

---

## 3. IPC & Event Bus Schema

### 3.1 Command Registry (Frontend → Backend)

All commands return `Promise<Result<T, AppError>>`.

| Namespace | Command | Payload | Return Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| **system** | `get_system_stats` | `-` | `SystemStats` | Static hardware info (CPU Model, RAM Total). |
| | `open_in_explorer` | `{path: string}` | `void` | ShellExecute wrapper. |
| **modules** | `download_module` | `{id: string, url: string}` | `void` | Triggers event-driven download & extract. |
| | `start_module` | `{id: string}` | `void` | Spawns process via `ModuleController`. |
| | `stop_module` | `{id: string}` | `void` | `taskkill /pid` or `SIGTERM`. |
| **secure** | `save_secure_key` | `{service: string, key: string}` | `void` | Encrypts and persists value. |
| | `get_secure_key` | `{service: string}` | `Option<string>` | Decrypts and returns value. |
| **ai** | `send_chat_message` | `ChatRequest` | `ChatResponse` | See struct definitions below. |
| **window** | `minimize_window` | `-` | `void` | Minimizes current window. |
| | `maximize_window` | `-` | `void` | Maximizes current window. |
| | `show_window` | `-` | `void` | Shows existing window. |
| | `hide_window` | `-` | `void` | Hides window (keeps process). |
| **theme** | `get_theme_colors` | `-` | `ThemeColors` | Returns system accent colors. |
| **license** | `get_license_status` | `-` | `LicenseStatus` | Check activation state. |
| | `activate_license` | `{key: string}` | `Result` | Validates and saves key. |

### 3.2 Event Stream (Backend → Frontend)

Subscribed via `TauriProvider.listen<T>()`.

| Topic | Frequency | Payload Structure (TS Interface) |
| :--- | :--- | :--- |
| `system_stats` | 1000ms | `interface SystemStats { cpu: { percent: number; ... }; ram: { used_gb: number; ... }; ... }` |
| `download_progress`| Real-time | `interface DownloadProgress { module_id: string; status: string; progress: number; message: string; total: number; }` |

### 3.3 Data Models (Strict)

**ChatRequest** (`domain/ai/ai_service.rs`)
```typescript
interface ChatRequest {
  provider: string; // 'openai' | 'gemini' | 'gpt' | 'deepseek' | ...
  model: string;
  messages: ChatMessage[];
  api_key?: string;
  thinking_level?: 'low' | 'high' | 'minimal';
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | any[]; // Multimodal support
  thought_signature?: string;
}
```

**SystemStats** (`domain/monitoring/system_monitor.rs`)
```typescript
interface SystemStats {
  cpu: { percent: number; cores: number; name: string };
  ram: { percent: number; used_gb: number; total_gb: number; available_gb: number };
  gpu?: { usage: number; memory_used: number; name: string };
  vram?: { percent: number; used_gb: number; total_gb: number };
  disk: { read_rate: number; write_rate: number; utilization: number; activity_percent: number };
  network: { download_rate: number; upload_rate: number; activity_percent: number };
  pid: number;
}
```

---

## 4. Project Source Structure

```text
Axelate/
├── src/                           # Frontend (Vite + TypeScript)
│   ├── app/                       # Boot sequence (init, router, events, bridge)
│   ├── features/                  # Feature modules
│   │   ├── ai/                    # AI Bridge & providers
│   │   ├── chat/                  # Chat interface
│   │   ├── dashboard/             # Main dashboard
│   │   ├── debug/                 # Debug tools
│   │   ├── downloads/             # Module downloader UI
│   │   ├── monitoring/            # System monitoring UI
│   │   └── settings/              # App settings & configs
│   ├── shared/                    # Cross-feature services, components, types
│   ├── infrastructure/            # Technical adapters (tauri/, i18n/, navigation/)
│   └── styles/                    # CSS (base/, components/, features/, layouts/)
│
├── src-tauri/                     # Backend (Rust Kernel)
│   └── src/
│       ├── api/                   # Tauri command adapters (thin, no logic)
│       ├── domain/                # Business logic (ai/, modules/, monitoring/, license/)
│       ├── infrastructure/        # Implementation (config/, crypto/, http/, logging/)
│       ├── models/                # Shared data types
│       ├── utils/                 # Pure helpers (paths, process, memory, windows)
│       ├── errors.rs              # Centralized error types
│       └── lib.rs                 # App entry, tray, setup
│
└── docs/                          # Documentation (en/, ru/)
```

---

## 5. Backend Services (`src-tauri/src/domain/`)

### 5.1 AI Service (`domain/ai/ai_service.rs`)

* **Providers**: OpenAI, Google (Gemini), Anthropic (via OpenRouter/Proxy), DeepSeek, Llama.
* **Thinking Engines**: Supports 'reasoning_effort' (OpenAI) and 'thinking' (Anthropic/DeepSeek) protocols.
* **Note**: Frontend `AIBridge.ts` handles prompt construction and stream management.
* **Security**: Keys are fetched from SecureStorage per-request.

### 5.2 Secure Storage (`infrastructure/crypto/secure_storage.rs`)

* **Engine**: AES-256-GCM.
* **Binding**: Machine-bound via unique Hardware ID.

### 5.3 System Services

* **ModuleController**: manages isolated processes (`domain/modules/controller.rs`).
* **Downloader**: Async-stream based downloader with hash verification (`domain/modules/downloader.rs`).
* **SystemMonitor**: Real-time hardware polling (`domain/monitoring/system_monitor.rs`).
* **License**: Offline/Online license state validation (`domain/license/`).

### 5.4 Filesystem Layout

Axelate stores application data under a single roaming root:

* **Root**: `%APPDATA%/AxelateData`
* **User data**: `%APPDATA%/AxelateData/User/...`
* **System data**: `%APPDATA%/AxelateData/System/...`

On Windows, older builds could place `System` under `%LOCALAPPDATA%/AxelateData/System`. Current builds migrate that data into the roaming root during startup.

---

<div align="center">
  <br>
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Report_Bug-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Report Bug" /></a>
  &nbsp;
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Request_Feature-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Request Feature" /></a>
  &nbsp;
  <a href="../../SECURITY.md"><img src="https://img.shields.io/badge/Security_Policy-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Security Policy" /></a>
  <br>
  <br>
  <img src="https://img.shields.io/badge/Made_with_❤️_by_Axelate_Team-31303a?style=flat-square" alt="Made with Love" />
  <br>
  <sub>Copyright © 2026 Axelate. All Rights Reserved.</sub>
</div>
