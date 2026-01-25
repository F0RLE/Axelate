<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Flux Platform Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Flux Platform</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Архитектурная Спецификация</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Главная-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="architecture.md"><img src="https://img.shields.io/badge/Документация-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Docs"/></a>
  </p>
  <br />
</div>

---

---

## Версия 0.1.1 (Публичная Бета)

> **Proprietary Notice**<br>Этот документ содержит внутренние детали архитектуры Flux Platform. Предназначен для Core-инженеров.

---

## 1. Основные Столпы Инженерии

### 1.1 Гибридная Архитектура Ядра (Hybrid Kernel)

Flux Platform построена как приложение с **Гибридным Ядром**.

* **Kernel (Rust)**: Обработка I/O, шифрование, управление потоками и запуск процессов. Полностью изолировано от UI-потока.
* **Shell (Vite/TS)**: Stateless слой рендеринга. Содержит **НОЛЬ** бизнес-логики касательно файловых операций или безопасности. Это чистая машина состояний визуализации.

### 1.2 Паттерн "Pass-Through" IPC

Мы строго избегаем тяжелого middleware. Запросы с фронтенда мапятся 1:1 к сервисам Rust.

* **Frontend**: `TauriProvider.invoke('get_system_stats')`
* **Bridge**: `commands::system::get_system_stats()`
* **Service**: `services::system_monitor::get_current_snapshot()`

---

## 2. Безопасность Низкого Уровня

### 2.1 Аппаратно-Связанное Шифрование (HBE)

Чувствительные данные (API ключи) шифруются ключом, производным от физического железа.

**Алгоритм:**

1. **Источник Энтропии A**: `machine_uid::get()` (Серийный номер матплаты / BIOS UUID).
2. **Источник Энтропии B**: Static Pepper `const PEPPER = "..."` (Вкомпилирован в бинарник).
3. **KDF**: `SHA256(Source A + Source B)` → 32-byte Key.
4. **Шифрование**: `AES-256-GCM`.
    * **Nonce**: Случайный 96-бит на каждую запись.

**Расположение Файла:** `%APPDATA%/FluxData/User/Configs/secure.enc` (Защищено HBE)

### 2.2 Гигиена Памяти

* **Zero-Trace**: Расшифрованные ключи живут в RAM *только* во время активного HTTP-запроса и сбрасываются мгновенно через `Drop`.
* **No Swap**: Секреты никогда не пишутся в дисковые логи или своп.

---

## 3. Схема IPC и Шина Событий

### 3.1 Реестр Команд (Frontend → Backend)

Все команды возвращают `Promise<Result<T, AppError>>`.

| Namespace | Command | Payload | Return Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| **system** | `get_system_stats` | `-` | `SystemStats` | Статическая информация о системе (CPU, RAM). |
| | `open_in_explorer` | `{path: string}` | `void` | Обертка над ShellExecute. |
| **modules** | `download_module` | `{id: string, url: string}` | `void` | Триггерит событийную загрузку. |

| **secure** | `save_key` | `{key: string, val: string}` | `void` | Шифрует и сохраняет значение. |
| **ai** | `send_chat_message` | `ChatRequest` | `ChatResponse` | См. структуры данных ниже. |
| **window** | `minimize_window` | `-` | `void` | Сворачивает текущее окно. |
| **theme** | `get_theme_colors` | `-` | `ThemeColors` | Возвращает системные цвета. |

### 3.2 Поток Событий (Backend → Frontend)

Подписка через `EventBus.ts` (TS) или `app_handle.emit_all` (Rust).

| Topic | Frequency | Payload Structure (TS Interface) |
| :--- | :--- | :--- |
| `system_stats` | 1000ms | `interface SystemStats { cpu: { percent: number; ... }; ram: { used_gb: number; ... }; ... }` |
| `download_progress`| Real-time | `interface DownloadProgress { module_id: string; status: string; progress: number; message: string; total: number; }` |

### 3.3 Модели Данных (Strict)

**ChatRequest** (`ai_service.rs`)
```typescript
interface ChatRequest {
  provider: 'openai' | 'gemini' | 'local';
  model: string;
  messages: { role: string; content: string }[];
  api_key?: string;
}
```

**SystemStats** (`system.rs`)
```typescript
interface SystemStats {
  cpu: { percent: number; cores: number; name: string };
  ram: { percent: number; used_gb: number; total_gb: number; available_gb: number };
  gpu?: { usage: number; memory_used: number; name: string };
  disk: { read_rate: number; write_rate: number; utilization: number };
  network: { download_rate: number; upload_rate: number };
}
```

---

## 4. Структура Исходного Кода

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
│   │   ├── core/              # Core Services (EventBus, Boot)
│   │   ├── dashboard/         # Главный дашборд
│   │   ├── debug/             # Инструменты отладки
│   │   ├── downloader/        # UI загрузчика модулей
└── docs/                      # Documentation
```

---

## 5. Rust-сервисы низкого уровня (`src-tauri/src/services/`)

### 5.1 AI Service (`ai_service.rs`)

* **Провайдеры**: OpenAI, Google (Gemini), Local (Ollama).
* **Безопасность**: Ключи достаются из SecureStorage для каждого запроса.

### 5.2 Secure Storage (`secure_storage.rs`)

* **Движок**: AES-256-GCM.
* **Привязка**: HBE (Hardware-Bound).

---

*Confidential Engineering Documentation. Ground-Truth Verified.*

<div align="center">
  <br>
  <a href="https://github.com/F0RLE/flux-platform/issues"><img src="https://img.shields.io/badge/Сообщить_о_Баге-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Report Bug" /></a>
  &nbsp;
  <a href="https://github.com/F0RLE/flux-platform/issues"><img src="https://img.shields.io/badge/Запросить_Фичу-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Request Feature" /></a>
  &nbsp;
  <a href="../../SECURITY.md"><img src="https://img.shields.io/badge/Политика_Безопасности-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Security Policy" /></a>
  <br>
  <br>
  <img src="https://img.shields.io/badge/Сделано_с_❤️_командой_Flux-31303a?style=flat-square" alt="Made with Love" />
  <br>
  <sub>Copyright © 2026 Flux Platform. All Rights Reserved.</sub>
</div>
