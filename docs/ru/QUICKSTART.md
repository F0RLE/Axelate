<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Axelate Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Axelate</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Быстрый старт</p>
  <br />
  <p>
    <a href="../../README.md"><img src="https://img.shields.io/badge/Home-31303a?style=for-the-badge&logo=house&logoColor=white" height="30" alt="Home"/></a>
    &nbsp;
    <a href="development.md"><img src="https://img.shields.io/badge/Разработка-31303a?style=for-the-badge&logo=gitbook&logoColor=white" height="30" alt="Development"/></a>
    &nbsp;
    <a href="architecture.md"><img src="https://img.shields.io/badge/Архитектура-31303a?style=for-the-badge&logo=blueprint&logoColor=white" height="30" alt="Architecture"/></a>
  </p>
  <br />
</div>

---

# Быстрый старт с Axelate

> Начните работу с Axelate менее чем за 5 минут.

## Что такое Axelate?

**Axelate** — это защищённая десктоп-среда для AI-агентов нового поколения. Основные преимущества:

- 🛡️ **Аппаратная безопасность** — Шифрование AES-256-GCM, привязанное к материнской плате
- ⚡ **Нативная производительность** — Ядро Rust + оболочка V8, мгновенный запуск
- 🧩 **Изолированные модули** — Запускайте AI-инструменты без перекрёстного влияния

---

## Быстрая установка

1. **Скачайте** установщик со страницы [Релизы](https://github.com/F0RLE/Axelate/releases)
2. **Запустите** `Axelate Setup.exe`
3. **Откройте** Axelate из меню Пуск или с рабочего стола

---

## Первый запуск

### 1. Настройте AI-провайдера

1. Перейдите в **Настройки** → **AI-провайдеры**
2. Выберите провайдера (OpenAI GPT, Google Gemini)
3. Введите API-ключ (хранится безопасно через системный keychain)
4. Нажмите **Сохранить**

### 2. Начните чат-сессию

1. Нажмите **Чат** в боковой панели
2. Выберите AI-провайдера из выпадающего списка
3. Введите сообщение и нажмите Enter

### 3. Мониторинг ресурсов

Панель **Мониторинг** отображает использование CPU, RAM, GPU и диска в реальном времени.

---

## Структура проекта (Для разработчиков)

```
Axelate/
├── src/                    # Frontend (Vanilla TypeScript)
│   ├── modules/            # Модули функций (core, ai, chat, settings...)
│   ├── css/                # Стили (дизайн-токены, компоненты)
│   └── templates/          # HTML-шаблоны
├── src-tauri/              # Backend (Rust + Tauri v2)
│   ├── src/commands/       # IPC-обработчики команд
│   ├── src/services/       # Бизнес-логика
│   └── src/models/         # Структуры данных
└── docs/                   # Документация
```

---

## Ключевые концепции

| Концепция | Описание |
|-----------|----------|
| **Core** | Центральный оркестратор (`src/modules/core/core.ts`), управляющий всеми сервисами |
| **EventBus** | Типизированный pub/sub для межмодульного взаимодействия |
| **StateService** | Персистентное UI-состояние (приоритет бэкенда, fallback — localStorage) |
| **AIBridge** | Singleton-маршрутизатор сообщений к AI-провайдерам (GPT/Gemini) |
| **TauriProvider** | Абстракция для Tauri IPC с поддержкой mock-режима |

---

## Команды разработки

```bash
# Запуск dev-сервера
cd src && npm run tauri:dev

# Запуск тестов
npm run test

# Проверка и форматирование
npm run lint && npm run format

# Сборка для продакшена
npm run tauri:build
```

---

## Полезные ссылки

- [Архитектура](architecture.md)
- [Руководство разработчика](development.md)
- [Стандарты кодирования](CODING_STANDARDS.md)
- [Правила контрибуции](../../CONTRIBUTING.md)

---

<div align="center">

**Готовы к разработке?** Смотрите [Руководство разработчика](development.md) →

</div>
