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

## 1. Установка

1.  **Клонирование репозитория**
    ```bash
    git clone https://github.com/F0RLE/Axelate.git
    ```

2.  **Установка зависимостей**
    ```bash
    npm install       # Корень
    cd src && npm i   # Фронтенд
    ```

3.  **Запуск в режиме разработки**
    ```bash
    # Из корня
    npm run tauri:dev
    ```

---

## 2. Требования к окружению

| Инструмент | Версия | Почему? |
| :--- | :--- | :--- |
| **Rust** | `1.93.0`+ (Stable) | Оптимизация памяти и новые возможности async. |
| **Node.js** | `22.x` (LTS) | Нативная поддержка top-level await и ESM. |
| **pnpm** | `9.x`+ | Производительность и строгая структура зависимостей. |

---

## 3. Полезные ссылки

*   **Архитектура**: [architecture.md](architecture.md) - Глубокое описание систем.
*   **Стандарты кода**: [CODING_STANDARDS.md](CODING_STANDARDS.md) - Паттерны и правила качества.
*   **Безопасность**: [SECURITY.md](../../SECURITY.md) - Отчеты об уязвимостях.

---

<div align="center">
  <br>
  <sub>Copyright © 2026 Axelate. All Rights Reserved.</sub>
</div>
