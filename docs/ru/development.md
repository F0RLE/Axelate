<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Axelate Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Начало работы</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Home-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="architecture.md"><img src="https://img.shields.io/badge/Архитектура-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Architecture"/></a>
    &nbsp;
    <a href="CODING_STANDARDS.md"><img src="https://img.shields.io/badge/Стандарты-31303a?style=for-the-badge&logo=eslint&logoColor=white" height="30" alt="Standards"/></a>
  </p>
  <br />
</div>

---

## 1. Требования

Перед началом убедитесь, что установлено следующее:

| Инструмент | Требуемая версия | Установка |
| :--- | :--- | :--- |
| **Rust** | `1.93.0`+ (Stable) | [rustup.rs](https://rustup.rs/) |
| **Node.js** | `22.x` (LTS) | [nodejs.org](https://nodejs.org/) |
| **pnpm** | `9.x`+ | `npm install -g pnpm` |
| **Visual Studio Build Tools** | 2022+ | Требуется для компиляции Rust на Windows |

---

## 2. Установка

### 2.1 Клонирование репозитория

```bash
git clone https://github.com/F0RLE/Axelate.git
cd Axelate
```

### 2.2 Установка зависимостей

```bash
# Корневые зависимости (Tauri CLI, Husky)
npm install

# Зависимости фронтенда
cd src && npm install
```

### 2.3 Проверка Rust

```bash
rustc --version    # Должно быть 1.93.0+
cargo --version
```

---

## 3. Рабочий процесс разработки

### 3.1 Запуск Dev-сервера

```bash
# Из директории src/
npm run tauri:dev
```

Это выполнит:
1. Запуск Vite dev сервера на `http://localhost:1420`
2. Запуск Tauri приложения с hot-reload
3. Открытие DevTools для отладки фронтенда

### 3.2 Разработка только фронтенда

```bash
cd src
npm run dev    # Только Vite dev сервер (без Tauri)
```

> **Примечание:** Некоторые функции требуют Tauri (IPC, secure storage). Используйте mock-режим в `TauriProvider.ts`.

### 3.3 Изменения только в бэкенде

```bash
cd src-tauri
cargo check         # Быстрая проверка синтаксиса/типов
cargo clippy        # Линтинг с ошибками как предупреждениями
cargo build         # Полная дебаг-сборка
```

---

## 4. Обзор структуры проекта

```
Axelate/
├── src/                       # Frontend (TypeScript + Vite)
│   ├── modules/               # Функциональные модули
│   │   ├── core/              # Основные сервисы (EventBus, State и др.)
│   │   ├── ai/                # AI Bridge и провайдеры
│   │   ├── chat/              # Интерфейс чата
│   │   ├── settings/          # Настройки приложения
│   │   ├── monitoring/        # Системный мониторинг
│   │   └── ...
│   ├── css/                   # Стили (дизайн-токены)
│   ├── templates/             # HTML-шаблоны
│   └── test/                  # Vitest тесты
├── src-tauri/                 # Backend (Rust + Tauri v2)
│   ├── src/
│   │   ├── commands/          # IPC обработчики команд
│   │   ├── services/          # Бизнес-логика
│   │   ├── models/            # Структуры данных
│   │   └── utils/             # Утилиты
│   └── resources/             # Конфигурации, локали
└── docs/                      # Документация
```

---

## 5. Отладка

### 5.1 Фронтенд (DevTools)

- Нажмите `F12` или `Ctrl+Shift+I` для открытия DevTools
- Логи консоли используют префиксы: `[ModuleName] Message`
- Панель отладки доступна в DEV режиме (триггер справа внизу)

### 5.2 Бэкенд (Rust Logs)

```bash
# Установка уровня логирования
RUST_LOG=debug npm run tauri:dev
```

Расположение логов: `%APPDATA%/AxelateData/logs/`

### 5.3 Отладка IPC

Все IPC вызовы логируются:
```
[TauriProvider] Invoking: command_name {...args}
[TauriProvider] Invoke success: command_name
```

---

## 6. Тестирование

### 6.1 Запуск тестов фронтенда

```bash
cd src
npm run test              # Запуск всех тестов
npm run test:watch        # Watch-режим
npm run test:coverage     # С отчётом о покрытии
```

### 6.2 Запуск тестов бэкенда

```bash
cd src-tauri
cargo test
```

### 6.3 Линтинг и форматирование

```bash
cd src
npm run lint              # Проверка ESLint
npm run lint:fix          # Авто-исправление
npm run format            # Форматирование Prettier
npm run format:check      # Проверка форматирования
```

---

## 7. Сборка для продакшена

### 7.1 Дебаг-сборка

```bash
npm run tauri:build
```

### 7.2 Релизная сборка

```bash
cd src
npm run release    # Оптимизированная сборка
```

Результат: `src-tauri/target/release/bundle/`

---

## 8. Частые проблемы

| Проблема | Решение |
| :--- | :--- |
| `WebView2 not found` | Установите [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| `cargo build` падает | Выполните `rustup update` и установите Visual Studio Build Tools |
| Порт 1420 занят | Завершите процесс или измените порт в `vite.config.ts` |
| Белый экран при запуске | Проверьте консоль DevTools на ошибки |

---

## 9. Полезные ссылки

- **Архитектура**: [architecture.md](architecture.md) - Глубокое описание систем
- **Стандарты кода**: [CODING_STANDARDS.md](CODING_STANDARDS.md) - Паттерны и правила качества
- **Безопасность**: [SECURITY.md](../../SECURITY.md) - Отчёты об уязвимостях
- **Быстрый старт**: [QUICKSTART.md](QUICKSTART.md) - Быстрое введение

---

<div align="center">
  <br>
  <sub>Copyright © 2026 Axelate. All Rights Reserved.</sub>
</div>
