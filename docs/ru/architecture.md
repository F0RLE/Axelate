<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Axelate Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Спецификация архитектуры</p>
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

## Версия 0.1.x (Public Beta)

> **Конфиденциальное уведомление**<br>Данный документ содержит глубокие внутренние детали архитектуры Axelate. Предназначен для ведущих инженеров. Несанкционированное распространение запрещено.

---

## 1. Основные инженерные принципы

### 1.1 Гибридная архитектура ядра (Hybrid Kernel)

Axelate построена как приложение с **гибридным ядром**.
*Подробные правила структуры определены в [CODING_STANDARDS.md](CODING_STANDARDS.md).*

* **Kernel (Rust)**: Отвечает за прямой ввод-вывод (I/O), шифрование и управление процессами.
* **Shell (TS)**: Слой визуализации без состояния. Прямой I/O запрещен.

### 1.2 Паттерн "Свозной" IPC (Pass-Through)

Запросы напрямую сопоставляются с сервисами Rust без тяжелого промежуточного ПО.
*Паттерны реализации: см. раздел IPC в [CODING_STANDARDS.md](CODING_STANDARDS.md).*

---

## 2. Низкоуровневая спецификация безопасности

### 2.1 Аппаратное шифрование (Hardware-Bound Encryption — HBE)

Чувствительные данные (API ключи, OAuth токены) шифруются с использованием ключа, производного от физического оборудования.

**Алгоритм:**

1. **Источник энтропии A**: `machine_uid::get()` (серийный номер материнской платы / UUID BIOS).
2. **Источник энтропии B**: Статическая соль `const SALT = "AXELATE_PLATFORM_SECURE_SALT_"` (скомпилировано в бинарный файл).
3. **Функция вывода ключа (KDF)**: `SHA256(Source A + SALT + Source A)` → 32-байтный ключ.
4. **Шифрование**: `AES-256-GCM` (Galois/Counter Mode).
    * **Nonce**: Случайный 96-битный на каждую запись.
    * **Tag**: 128-битный тег аутентификации, добавляемый к шифртексту.

**Расположение файла:** `%APPDATA%/AxelateData/User/Configs/secure.enc` (защищено HBE)

### 2.2 Гигиена оперативной памяти

* **Zero-Trace (Нулевой след)**: Расшифрованные ключи существуют в RAM *только* во время активного жизненного цикла HTTP-запроса и немедленно удаляются через трейт `Drop` в Rust.
* **No Swap (Без подкачки)**: Секреты никогда не записываются в логи диска или временные файлы кэша.

---

## 3. Схема IPC и событийной шины (Event Bus)

### 3.1 Реестр команд (Frontend → Backend)

Все команды возвращают `Promise<Result<T, AppError>>`.

| Пространство имен | Команда | Данные (Payload) | Тип возврата | Описание |
| :--- | :--- | :--- | :--- | :--- |
| **system** | `get_system_stats` | `-` | `SystemStats` | Статическая информация об оборудовании (модель ЦП, всего ОЗУ). |
| | `open_in_explorer` | `{path: string}` | `void` | Обертка ShellExecute. |
| **modules** | `download_module` | `{id: string, url: string}` | `void` | Запускает управляемую событиями загрузку и извлечение. |
| | `start_module` | `{id: string}` | `void` | Создает процесс через `ModuleController`. |
| | `stop_module` | `{id: string}` | `void` | `taskkill /pid` или `SIGTERM`. |
| **secure** | `save_secure_key` | `{service: string, key: string}` | `void` | Шифрует и сохраняет значение. |
| | `get_secure_key` | `{service: string}` | `Option<string>` | Расшифровывает и возвращает значение. |
| **ai** | `send_chat_message` | `ChatRequest` | `ChatResponse` | См. определения структур ниже. |
| **window** | `minimize_window` | `-` | `void` | Сворачивает текущее окно. |
| | `maximize_window` | `-` | `void` | Разворачивает текущее окно. |
| | `show_window` | `-` | `void` | Показывает существующее окно. |
| | `hide_window` | `-` | `void` | Скрывает окно (сохраняет процесс). |
| **theme** | `get_theme_colors` | `-` | `ThemeColors` | Возвращает акцентные цвета системы. |
| **license** | `get_license_status` | `-` | `LicenseStatus` | Проверка состояния активации. |
| | `activate_license` | `{key: string}` | `Result` | Проверяет и сохраняет ключ. |

### 3.2 Поток событий (Backend → Frontend)

Подписка через `EventBus.ts` (TS) или `app_handle.emit_all` (Rust).

| Тема | Частота | Структура данных (TS интерфейс) |
| :--- | :--- | :--- |
| `system_stats` | 1000мс | `interface SystemStats { cpu: { percent: number; ... }; ram: { used_gb: number; ... }; ... }` |
| `download_progress`| Реалтайм | `interface DownloadProgress { module_id: string; status: string; progress: number; message: string; total: number; }` |

### 3.3 Модели данных (Строгие)

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
  content: string | any[]; // Поддержка мультимодальности
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

## 4. Структура исходного кода проекта

```text
Axelate/
├── src-tauri/                 # Бэкенд (Ядро Rust)
│   ├── src/
│   │   ├── commands/          # Регистрация команд IPC
│   │   ├── services/          # Реализация бизнес-логики
│   │   └── main.rs            # Точка входа
├── src/                       # Фронтенд (Оболочка Vite + TS)
│   ├── modules/               # Функциональные модули
│   │   ├── ai/                # Мост ИИ и провайдеры
│   │   ├── chat/              # Интерфейс чата
│   │   ├── core/              # Основные сервисы (EventBus, Boot)
│   │   ├── dashboard/         # Главная панель управления
│   │   ├── debug/             # Инструменты отладки
│   │   ├── downloader/        # Модуль загрузки
│   │   ├── monitoring/        # Модуль системного мониторинга
│   │   └── settings/          # Настройки приложения
└── docs/                      # Документация
```

---

## 5. Низкоуровневые сервисы Rust (`src-tauri/src/services/`)

### 5.1 AI Service (`ai_service.rs`)

* **Провайдеры**: OpenAI, Google (Gemini), Anthropic (через OpenRouter/Proxy), DeepSeek, Llama.
* **Движки рассуждений (Thinking Engines)**: Поддержка протоколов 'reasoning_effort' (OpenAI) и 'thinking' (Anthropic/DeepSeek).
* **Примечание**: Фронтенд-сервис `AIBridge.ts` управляет формированием промптов и обработкой потока.
* **Безопасность**: Ключи извлекаются из SecureStorage для каждого запроса.

### 5.2 Secure Storage (`secure_storage.rs`)

* **Движок**: AES-256-GCM.
* **Привязка**: К конкретному железу через уникальный Hardware ID.

### 5.3 Системные сервисы

* **ModuleController**: управление изолированными процессами (`module_controller.rs`).
* **Downloader**: Асинхронный загрузчик на основе потоков с верификацией хэша (`downloader.rs`).
* **SystemMonitor**: Опрос состояния оборудования в реальном времени (`system_monitor.rs`).
* **License**: Валидация состояния лицензии в оффлайн/онлайн режимах (`license/`).

---

<div align="center">
  <br>
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Сообщить_об_ошибке-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Сообщить об ошибке" /></a>
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Сообщить_об_ошибке-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Сообщить об ошибке" /></a>
  &nbsp;
  <a href="https://github.com/F0RLE/Axelate/issues"><img src="https://img.shields.io/badge/Предложить_функцию-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Предложить функцию" /></a>
  &nbsp;
  <a href="../../SECURITY.md"><img src="https://img.shields.io/badge/Политика_безопасности-31303a?style=for-the-badge&logo=github&logoColor=white" height="30" alt="Политика безопасности" /></a>
  <br>
  <br>
  <img src="https://img.shields.io/badge/Сделано_с_❤️_командой_Axelate-31303a?style=flat-square" alt="Сделано с любовью" />
  <br>
  <sub>Copyright © 2026 Axelate. Все права защищены.</sub>
</div>
