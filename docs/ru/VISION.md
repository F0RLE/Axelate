# Axelate

Это текущее описание проекта, без фантазий про будущие фазы.

## Что проект делает сейчас

- desktop launcher на Rust + Tauri v2
- чат через OpenRouter
- установка и запуск локальных движков `llama.cpp` и `stable-diffusion.cpp`
- локальное безопасное хранение настроек и ключей

## Стек

- backend: Rust, Tokio, Tauri v2, Axum
- frontend: vanilla TypeScript, Vite
- мост типов: Specta

## Структура репозитория

```text
Axelate/
├── src/         frontend и все npm-зависимости
├── src-tauri/   backend и Tauri-конфиг
├── docs/        документация
└── .github/     scripts, workflows, hooks
```

## Важные факты

- `src/` это единственный npm-проект с зависимостями
- корневой `package.json` только проксирует команды
- порты локальных движков выбирает backend автоматически
- Rust-типы являются источником правды, TypeScript биндинги генерируются

## Быстрый запуск для разработки

Из корня репозитория:

```bash
npm run install-deps
npm run dev
```

## Полезные документы

- [Getting Started](../en/getting-started.md)
- [Architecture](../en/architecture.md)
- [Automation](../en/AUTOMATION.md)
- [Coding Standards](../en/CODING_STANDARDS.md)
