<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Flux Platform Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Flux Platform</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Architecture Specification</p>
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

## Version 0.1.x (Public Beta)

> **Proprietary Notice**<br>This document contains deep internal details of the Flux Platform architecture. Intended for Core Engineers. Unauthorized distribution is prohibited.

---

## 1. Core Engineering Pillars

### 1.1 Гибридная архитектура ядра (Hybrid Kernel)

Flux Platform построена как приложение с **гибридным ядром**.
*Подробные правила структуры определены в [CODING_STANDARDS.md](CODING_STANDARDS.md).*

* **Kernel (Rust)**: Отвечает за прямой ввод-вывод (I/O), шифрование и управление процессами.
* **Shell (TS)**: Слой визуализации без состояния. Прямой I/O запрещен.

### 1.2 Паттерн "Pass-Through" IPC

Запросы напрямую сопоставляются с сервисами Rust без тяжелого промежуточного ПО.
*Паттерны реализации: см. раздел IPC в [CODING_STANDARDS.md](CODING_STANDARDS.md).*

---

## 2. Low-Level Security Specification

### 2.1 Hardware-Bound Encryption (HBE)

Sensitive data (API Keys, OAuth Tokens) is encrypted using a key derived from the physical hardware.

**Algorithm:**

1. **Entropy Source A**: `machine_uid::get()` (Motherboard Serial / BIOS UUID).
2. Entropy Source B**: Static Salt `const SALT = "FLUX_PLATFORM_SECURE_SALT_"` (Compiled into binary).
3. **Key Derivation Function (KDF)**: `SHA256(Source A + SALT + Source A)` → 32-byte Key.
4. **Encryption**: `AES-256-GCM` (Galois/Counter Mode).
    * **Nonce**: Random 96-bit per write.
    * **Tag**: 128-bit authentication tag appended to ciphertext.

**File Location:** `%APPDATA%/FluxData/User/Configs/secure.enc` (HBE-protected)

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

Subscribed via `EventBus.ts` (TS) or `app_handle.emit_all` (Rust).

| Topic | Frequency | Payload Structure (TS Interface) |
| :--- | :--- | :--- |
| `system_stats` | 1000ms | `interface SystemStats { cpu: { percent: number; ... }; ram: { used_gb: number; ... }; ... }` |
| `download_progress`| Real-time | `interface DownloadProgress { module_id: string; status: string; progress: number; message: string; total: number; }` |

### 3.3 Data Models (Strict)

**ChatRequest** (`ai_service.rs`)
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

**SystemStats** (`system.rs`)
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
Flux Platform/
├── src-tauri/                 # Backend (Rust Kernel)
│   ├── src/
│   │   ├── commands/          # IPC Command Registry
│   │   ├── services/          # Core Business Logic
│   │   └── main.rs            # Entry Point
├── src/                       # Frontend (Vite + TS Shell)
│   ├── modules/               # Feature Modules
│   │   ├── ai/                # AI Bridge & Providers
│   │   ├── chat/              # Chat Interface
│   │   ├── core/              # Core Services (EventBus, Boot)
│   │   ├── dashboard/         # Main UI Dashboard
│   │   ├── debug/             # Debug Tools
│   │   ├── downloader/        # Module Downloader UI
│   │   ├── monitoring/        # System Monitoring UI
│   │   └── settings/          # App Settings & Configs
└── docs/                      # Documentation
```

---

## 5. Low-Level Rust Services (`src-tauri/src/services/`)

### 5.1 AI Service (`ai_service.rs`)

* **Providers**: OpenAI, Google (Gemini), Anthropic (via OpenRouter/Proxy), DeepSeek, Llama.
* **Thinking Engines**: Supports 'reasoning_effort' (OpenAI) and 'thinking' (Anthropic/DeepSeek) protocols.
* **Note**: Frontend `AIBridge.ts` handles prompt construction and stream management.
* **Security**: Keys are fetched from SecureStorage per-request.

### 5.2 Secure Storage (`secure_storage.rs`)

* **Engine**: AES-256-GCM.
* **Binding**: Machine-bound via unique Hardware ID.

### 5.3 System Services

* **ModuleController**: manages isolated processes (`module_controller.rs`).
* **Downloader**: Async-stream based downloader with hash verification (`downloader.rs`).
* **SystemMonitor**: Real-time hardware polling (`system_monitor.rs`).
* **License**: Offline/Online license state validation (`license/`).

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
