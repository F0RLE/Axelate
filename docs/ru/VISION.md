# Axelate

Это текущее описание проекта без фантазий.

## Что проект умеет сейчас

- desktop launcher на Rust + Tauri v2
- чат с AI через OpenRouter
- единая настройка AI-провайдеров и локальных движков
- установка и запуск локальных модулей
- безопасное хранение ключей и чувствительных настроек на backend-стороне
- мониторинг, загрузки, console page, settings

## Что уже есть в продукте

### 1. Chat

- отдельная вкладка чата
- потоковый ответ от AI
- изоляция запросов по request id
- история и служебная orchestration-логика на frontend

### 2. Local AI modules

Сейчас проект уже умеет работать как launcher для локальных AI-движков.

Подтверждено по коду:

- `llama.cpp`
- `stable-diffusion.cpp`
- `ComfyUI`

Backend сам:

- смотрит железо
- подбирает совместимый release asset
- проверяет SHA-256 digest
- скачивает и распаковывает модуль
- выбирает свободный localhost port
- запускает процесс и отслеживает lifecycle

### 3. AI provider layer

- OpenRouter уже интегрирован
- типы идут из Rust через Specta
- Tauri bridge тонкий, без дублирования бизнес-логики во frontend

### 4. Shell / launcher UI

Сейчас в приложении уже есть страницы:

- Home
- Chat
- Modules
- Marketplace
- Downloads
- Console
- Settings

Важно:

- `Marketplace` сейчас есть как часть интерфейса
- полноценная коммерческая логика покупки и удаленного запуска еще не реализована

## Что Axelate есть сегодня по смыслу

Сегодня Axelate — это launcher и unified shell для:

- локальных AI-движков
- API-based AI
- общения в чате
- управления загрузками и настройками

Пока это не marketplace публичных скриптов и не secure execution platform.

## Ближайшее продуктовое направление

Следующий большой слой:

- инъекция публичных скриптов или приложений через launcher
- удобная настройка этих script/app packages
- marketplace внутри Axelate
- покупка, скачивание, локальный запуск или удаленный запуск через прослойку

## Модель будущего marketplace

Планируемые режимы:

### Basic / Local

- пакет скачивается пользователю
- исполняется локально
- дешевле и проще
- защита базовая, без обещаний полной неуязвимости

### Protected / Managed

- чувствительная логика или весь запуск уходит на сервер
- подписка, доступ, expiry и sensitive operations контролируются backend
- лучше защита для дорогих проектов и коммерческих сценариев

## Важная граница доверия

Если код и секреты живут на машине пользователя, их нельзя считать полностью защищенными.

Поэтому для будущего marketplace модель такая:

- локальный режим для удобства и низкой цены
- managed/server режим для сильной защиты

## Связанные документы

- [Getting Started](../en/getting-started.md)
- [Architecture](../en/architecture.md)
- [Module Platform Spec](./MODULE_PLATFORM_SPEC.md)
- [Roadmap](../en/ROADMAP.md)
- [Automation](../en/AUTOMATION.md)
- [Security Hardening](../en/SECURITY_HARDENING.md)
