<div align="center">
  <br />
  <img src="../../src-tauri/icons/icon.png" alt="Flux Platform Logo" width="120" height="120" />
  <br />
  <h1 style="border-bottom: none; margin-bottom: 0;">Flux Platform</h1>
  <p style="font-size: 1.1em; color: #888; font-style: italic;">Руководство для разработчика</p>
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

> **Proprietary Notice**<br>Эта документация является конфиденциальной и регулируется EULA Flux Platform. Несанкционированное распространение запрещено.

---

## 1. Начало работы

### Установка

1.  **Клонирование репозитория**
    ```bash
    git clone https://github.com/F0RLE/flux-platform.git
    ```

2.  **Установка зависимостей**
    ```bash
    npm install       # Корень
    cd src && npm i   # Фронтенд
    ```

3.  **Запуск (Dev)**
    ```bash
    npm run tauri:dev
    ```

---

## 2. Настройка окружения (Строго)

| Инструмент | Версия | Почему? |
| :--- | :--- | :--- |
| **Rust** | `1.92.0`+ (Stable) | Оптимизаторы памяти и новые async-фичи. |
| **Node.js** | `22.x` (LTS) | Нативная поддержка Top-level await и ESM. |
| **pnpm** | `9.x`+ | Супер-быстрый менеджмент зависимостей. |

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

## 4. Событийный паттерн IPC

Для длительных задач (таких как загрузка модулей) используйте события Tauri вместо опроса (polling).

1. **Backend**: Отправка событий через `app.emit("event_name", payload)`.
2. **Frontend Service**: Подписка в конструкторе и ретрансляция через `globalThis.dispatchEvent`.
3. **UI Компоненты**: Подписка на DOM-событие и обновление интерфейса.

*Пример: См. `ModuleService.ts` и событие `download_progress`.*

---

## 5. Система Событий и IPC

Мы используем строго типизированную систему событий. Не используйте глобальные обработчики.

*   **Core Handler**: `src/modules/core/services/EventBus.ts` (Синглтон `eventBus`).
*   **Dispatch (Отправка)**: Используйте `eventBus.emit('name', { detail })`.
*   **Listen (Прослушивание)**: Используйте `eventBus.on('name', callback)`.

### Миграция Legacy-кода
*   ❌ `src/js/event-handlers.js` был **удален**.
*   ✅ Используйте компоненты из `src/modules` для всей новой логики.

---

## 6. Локализация и Темы

* **Локализация**: Данные загружаются через `translations.rs` и кэшируются во фронтенде через `I18nService`.
* **Темы**: Сервис `theme.rs` отслеживает изменения системной темы и обновляет CSS-переменные.

---

Приятного кодинга! - Команда Flux Platform

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
