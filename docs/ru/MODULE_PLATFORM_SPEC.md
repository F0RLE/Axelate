# Спецификация модулей Axelate

Этот документ фиксирует правильную модель для Axelate как хоста модулей, а не просто launcher-а для нескольких вручную зашитых интеграций.

Цель простая:

- любой модуль должен запускаться одинаково на Windows, Linux и macOS
- launcher должен владеть lifecycle, настройками, логами и runtime-путями
- модуль должен быть изолированной рабочей нагрузкой, а не вторым mini-launcher внутри launcher-а
- старые модули не должны ломаться при переходе на новую схему

## Статус

Что уже закреплено в коде:

- launcher использует общие директории `System/Modules`, `System/Runtime`, `System/Logs`
- script-модули запускаются как отдельные процессы под контролем launcher-а
- поддержан основной манифест `axelate-module.toml`
- legacy `module.json` остается рабочим для совместимости
- structured lifecycle-команды `program + args` уже лучше raw shell-строк и должны быть основным режимом

Что закрепляем как целевой контракт:

- человекочитаемый манифест в `TOML`
- launcher-owned логирование
- launcher-owned persisted settings
- один понятный runtime context для модуля
- отдельный домен API для модулей, а не смешение с UI/chat-доменом launcher-а

## Главный принцип

Launcher должен быть платформой. Модуль должен быть workload.

Это значит:

- launcher решает, где лежат данные, логи, runtime, temp и secrets
- launcher решает, когда модуль стартует, стопается и перезапускается
- launcher рисует настройки и валидирует их
- модуль не плодит свои собственные `.env`, `settings.json`, `logs/` и random state по дереву проекта без явного контракта

По умолчанию старт должен быть только явный:

- пользователь нажал `Start` в launcher
- launcher вызвал lifecycle по явному user action
- отдельный script/automation launcher-а сделал это осознанно

Нельзя считать выбор модуля в UI, открытие настроек или рестарт launcher-а командой на автозапуск workload.

Если модуль сам тащит свои пути, свою систему логов и свою схему конфигурации, то Axelate перестает быть платформой и превращается в папку со случайными приложениями.

## Разделение ответственности

Launcher хранит:

- установленные файлы модуля
- общие runtime-инструменты
- пользовательские и системные настройки
- secrets
- логи
- state процесса
- health и restart policy

Модуль хранит:

- свой код
- статические ресурсы
- runtime-кэш, который launcher разрешил хранить в выделенной папке модуля
- stdout/stderr и health-сигналы

Модуль не должен:

- писать launcher-конфиг напрямую
- писать launcher-логи напрямую
- выбирать себе произвольные папки вне выданного контракта
- отправлять сообщения в launcher chat domain, если это не часть отдельного module API
- запускать, останавливать или перезапускать другие модули самостоятельно

## Рекомендуемая структура пакета

```text
my-module/
├── axelate-module.toml
├── MODULE.md
├── settings-ui/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── src/
│   └── main.py
├── scripts/
├── pyproject.toml
└── assets/
```

Минимум для нормального модуля:

- `axelate-module.toml` — машинный контракт
- `MODULE.md` — человеческое описание
- `src/...` — код модуля

Опционально:

- `settings-ui/` — кастомный Web UI настроек, который launcher встраивает как module-owned settings page
- `pyproject.toml` — если модуль на Python и это не однофайловый script-only кейс

## Формат манифеста

Основной формат должен быть `axelate-module.toml`.

Почему `TOML`:

- он проще читать руками, чем JSON
- он хорошо подходит для конфигов и манифестов
- он без двусмысленности маппится в словари/структуры
- его удобно валидировать и расширять без уродливых строковых костылей

### Базовый пример

```toml
api_version = "2"
id = "axelate-telegram-bot"
name = "Telegram Bot"
version = "1.0.0"
description = "Rewrite and publish posts from Telegram sources."
author = "F0RLE"
type = "service"
icon = "🤖"
entry = "src/main.py"
readme = "MODULE.md"
settings_ui = "settings-ui/index.html"
dependencies = ["python"]

[lifecycle]
start = { program = "uv", args = ["run", "src/main.py"] }
stop = { program = "python", args = ["scripts/stop.py"] }
health = { program = "python", args = ["scripts/health.py"] }

[config_schema.bot_token]
field_type = "password"
label = "Bot Token"
required = true

[config_schema.target_channel_id]
field_type = "text"
label = "Target Channel ID"
required = true

[config_schema.telegram_source_mode]
field_type = "select"
label = "Source Mode"
default = "auto"
options = ["auto", "telethon", "web"]
```

### Правила для манифеста

- `id` только `[A-Za-z0-9_-]`
- `version` в semver
- `type` должен описывать роль модуля: `service`, `local`, `api`, `tool`
- `entry` обязателен для script-модулей
- lifecycle-команды должны быть structured, не shell-строками, если это возможно
- `MODULE.md` должен существовать для user-facing модуля
- `settings_ui` — основной путь для настройки серьезного модуля

## Почему не shell по умолчанию

Raw shell плох как стандарт:

- разные quoting rules на Windows, Linux и macOS
- больше риск инъекций
- сложнее диагностика
- сложнее понять ownership у аргументов

Нормальный стандарт:

- `program`
- `args`
- `working_dir` задает launcher
- `env` не раздувается десятками ключей

Shell оставлять только как legacy escape hatch для редких сценариев.

## Настройки модуля

Правильная модель:

- settings хранит launcher
- модуль читает уже готовые значения через контракт launcher-а
- модуль не изобретает свой `.env` и свои параллельные `json`/`yaml` файлы без крайней причины

### Источник правды

Источник правды должен быть один:

- launcher config store

Плохо:

- часть настроек в `.env`
- часть в `generation_config.json`
- часть в `channels.json`
- часть в runtime state

Такую схему невозможно нормально отлаживать и мигрировать.

### Как хранить

Целевая схема хранения:

- системные и user settings лежат в launcher store
- модульные настройки namespaced по ключу `modules.<module-id>.*`
- runtime state лежит отдельно от persisted config

Legacy-плоские ключи вида `<module>_<setting>` можно читать только как compatibility layer, но не как финальный стандарт.

## Кастомный Web UI настроек

Это основной режим для модулей:

- разработчик сам приносит `settings-ui/index.html`
- launcher открывает его внутри своего интерфейса
- дизайн полностью принадлежит модулю
- launcher не диктует layout, компоненты и визуальный стиль страницы

Это правильнее, когда модуль сам по себе является отдельным продуктом:

- сложные визуальные настройки
- preview-heavy UI
- drag-and-drop
- составные workflows
- объяснимые onboarding-экраны

### Главный принцип

Launcher в этом режиме остается платформой, а не уступает ownership.

Это значит:

- launcher хостит страницу, а не модуль
- launcher остается источником правды для persisted settings
- launcher дает bridge/API для чтения и записи настроек
- модульный Web UI не пишет конфиг напрямую на диск

Иначе получится не module settings page, а второй launcher внутри launcher-а.

### Что должно быть в манифесте

Пример:

```toml
api_version = "2"
id = "axelate-telegram-bot"
name = "Telegram Bot"
settings_ui = "settings-ui/index.html"
```

### Как launcher должен это открывать

Правильная модель:

- launcher создает встроенный settings host view
- грузит `settings_ui` из файлов модуля
- открывает страницу внутри sandboxed `iframe`
- общается со страницей только через `postMessage` bridge канала `axelate:module-settings`

Лучше считать это не `iframe ради iframe`, а встроенным module webview host.

### Минимальный bridge для settings UI

Текущий контракт host bridge:

- `getContext()`
- `getSettings()`
- `saveSettings(patch)`
- `markDirty(isDirty)`
- `notify(event, payload)`

Launcher сначала отправляет bootstrap-сообщение:

```ts
type ModuleSettingsHostReadyMessage = {
  channel: "axelate:module-settings";
  type: "host-ready";
  context: ModuleSettingsContext;
  settings: Record<string, unknown>;
};
```

Дальше модульная страница шлет запросы в родителя:

```ts
type ModuleSettingsBridgeRequest = {
  channel: "axelate:module-settings";
  requestId: string;
  method: "getContext" | "getSettings" | "saveSettings" | "markDirty" | "notify";
  payload?: unknown;
};

type ModuleSettingsBridgeResponse = {
  channel: "axelate:module-settings";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};
```

Пример контекста:

```ts
type ModuleSettingsContext = {
  bridgeVersion: 1;
  module: {
    id: string;
    name: string;
    category: string;
    type: string;
    settingsUi: string | null;
  };
  launcher: {
    language: string;
    theme: "light" | "dark" | "system";
  };
};
```

Пример минимального SDK на стороне модуля:

```ts
const CHANNEL = "axelate:module-settings";

export function createModuleSettingsBridge() {
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let hostOrigin = "*";

  globalThis.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data !== "object" || data === null || data.channel !== CHANNEL) {
      return;
    }

    if (event.origin && event.origin !== "null") {
      hostOrigin = event.origin;
    }

    if (typeof data.requestId !== "string") {
      return;
    }

    const entry = pending.get(data.requestId);
    if (entry === undefined) {
      return;
    }

    pending.delete(data.requestId);
    if (data.ok) {
      entry.resolve(data.result);
    } else {
      entry.reject(new Error(String(data.error || "Unknown bridge error")));
    }
  });

  return async function request(method: string, payload?: unknown): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return await new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      parent.postMessage({ channel: CHANNEL, requestId, method, payload }, hostOrigin);
    });
  };
}
```

Если страница открыта вне launcher-а, модуль должен уметь упасть в локальный preview-режим, например через `localStorage`, но это только dev fallback. Источник правды все равно launcher storage.

### Что launcher должен контролировать

Даже если UI рисует модуль, launcher должен контролировать:

- persisted storage
- secret storage
- dirty state
- close/discard flow
- error boundary
- logs открытия/сохранения
- происхождение и sandbox встроенной страницы

### Что модульный UI может делать

- рисовать свою страницу настроек как угодно
- использовать tabs, cards, preview blocks, onboarding
- читать текущие значения через bridge
- сохранять patch или full object через bridge
- показывать live preview, если это purely visual logic

### Что модульный UI не должен делать

- напрямую писать в launcher config files
- напрямую читать secrets с диска
- напрямую ходить в произвольные launcher internal domains
- запускать/останавливать модуль shell-командами из UI
- скрыто поднимать AI engine/provider через module API, если launcher сам его еще не активировал
- рассчитывать, что `window` будет содержать launcher-specific global API

Для lifecycle и системных действий нужен отдельный host API.

Для AI bridge правило жесткое:

- модуль может использовать только тот AI provider, который уже выбран launcher-ом
- local AI engine должен уже быть запущен launcher-ом
- module request не должен вызывать hidden start, hot-swap модели или смену provider

### Fallback-логика

Нужен обязательный fallback:

1. если `settings_ui` отсутствует или не загрузился
2. launcher показывает read-only info screen из `MODULE.md`

Так платформа остается устойчивой.

### Почему это правильнее

Плюсы такого режима:

- разработчик реально контролирует UX
- можно делать красивые module-native настройки
- launcher не раздувается кастомными полями под каждый кейс
- сложные модули не упираются в generic form builder

Минусы:

- выше сложность sandbox и bridge
- нужна строгая граница ответственности
- нужен fallback, иначе settings page станет хрупкой

### Итог по режимам UI

В Axelate должен быть один основной режим настроек:

1. `settings_ui` — полноценный module-owned Web UI

`config_schema` можно оставлять только как legacy compatibility layer для старых модулей, но не как стандарт платформы.

## Runtime contract

Модулю нужны не десять случайных env-переменных, а один ясный bootstrap context.

Целевой контракт:

- launcher создает `System/Runtime/Modules/<module-id>/launcher-context.toml`
- launcher передает путь к нему аргументом процесса
- модуль читает оттуда пути, язык, API endpoints, runtime dir и разрешенные возможности

Пример:

```toml
module_id = "axelate-telegram-bot"
language = "ru"
api_base = "http://127.0.0.1:3000/api/modules"
runtime_dir = "C:/Users/FORLE/AppData/Roaming/AxelateData/System/Runtime/Modules/axelate-telegram-bot"
log_dir = "C:/Users/FORLE/AppData/Roaming/AxelateData/System/Logs/Engines/axelate-telegram-bot"
config_namespace = "modules.axelate-telegram-bot"
```

Почему один context лучше:

- меньше связности
- легче логировать и дебажить
- легче мигрировать схему
- не надо плодить `.env`
- проще одинаково поддержать Python, Node.js и native binaries

Legacy env можно держать временно, но новые модули должны читать context file первым.

## Логирование

Правильная модель:

- модуль пишет в stdout/stderr
- launcher забирает потоки
- launcher складывает их в `System/Logs/Engines/<module-id>/`
- launcher показывает их в Console UI

Модуль не должен сам выбирать конечный log file как дефолтный путь.

Это важно потому что:

- rotation и cleanup должны быть централизованы
- UI launcher-а должен видеть единый поток логов
- модуль не должен спорить с launcher-ом за формат и location логов

### Рекомендуемый формат строки

```text
2026-04-15 09:31:41 [INFO] Bot started
2026-04-15 09:31:42 [WARN] Source channel is empty
2026-04-15 09:31:43 [ERROR] Failed to parse update
```

### Для Python

Для Python-модулей default path такой:

- использовать `logging.StreamHandler`
- писать в stdout/stderr
- file handlers включать только если launcher явно дал на это контракт

Иначе получается дублирование логов и путаница между логами модуля и логами launcher-а.

## Python-модули

Для Python правильный порядок такой:

1. если это полноценный проект — `pyproject.toml`
2. если это маленький script-модуль — допускается `uv` script workflow
3. launcher ставит/обновляет runtime и зависимости
4. модуль не качает себе Python произвольным способом без launcher-а

Практический стандарт:

- `uv` как основной installer/runtime manager
- `.python-version` опционально для pinning версии
- `pyproject.toml` для project metadata и зависимостей

Это лучше, чем кастомный bootstrap-хаос на shell/batch.

## Домены API

UI launcher-а и модули не должны жить в одном смысловом домене.

Правильное разделение:

- `/api/ui/*` — всё, что касается launcher UI
- `/api/modules/*` — всё, что касается модулей как workloads
- `/api/modules/ai/*` — module-facing AI gateway
- `/api/system/*` — системные read-only данные launcher-а

Модуль не должен писать сообщения в launcher chat и получать ответы так, будто он пользователь UI.

Для модулей нужен отдельный host domain:

- `get settings`
- `get language`
- `request text generation`
- `request image generation`
- `health`
- `publish events`

Так модуль становится first-class workload, а не скрытым UI-ботом.

## Lifecycle

Минимум для нормального модуля:

- `install`
- `start`
- `stop`
- `health`

Желательно:

- `restart`
- `upgrade`

Правила:

- launcher всегда знает PID/child handle
- launcher после рестарта восстанавливает autostart modules
- `Hide` не должен убивать модуль, если это не отдельная политика
- stop должен быть идемпотентным
- health не должен зависеть от UI

## MODULE.md

Каждый модуль должен иметь `MODULE.md`.

Там должно быть:

- что делает модуль
- какие настройки нужны
- какие внешние сервисы нужны
- как launcher его запускает
- где смотреть логи
- как проверить health
- какие ограничения у платформ

`MODULE.md` нужен человеку. `axelate-module.toml` нужен машине. Эти роли нельзя смешивать.

## Миграция без боли

Шаг 1:

- launcher поддерживает `axelate-module.toml`
- старый `module.json` остается как fallback

Шаг 2:

- новые модули получают `MODULE.md`
- новые модули получают `settings_ui`

Шаг 3:

- launcher переезжает с flat module settings на namespaced store
- legacy ключи читаются только для миграции

Шаг 4:

- новые script-модули получают `launcher-context.toml`
- старые env остаются как deprecated compatibility layer

## Итоговый стандарт

Если коротко, правильный модуль для Axelate выглядит так:

- манифест в `TOML`
- документация в `MODULE.md`
- настройки рисует сам модуль через `settings_ui`
- launcher остается владельцем storage и lifecycle
- модуль читает launcher context, а не роется по `.env`
- launcher владеет логами, runtime-путями и lifecycle
- модуль пишет только workload-логи и выполняет свою задачу

Именно такая схема позволяет загружать в Axelate любые боты, парсеры, генераторы и сервисные скрипты без превращения проекта в склад костылей.

## Источники

- [TOML v1.0.0](https://toml.io/en/v1.0.0)
- [VS Code webviews guidance](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [Grafana app plugin configuration page](https://grafana.com/developers/plugin-tools/tutorials/build-an-app-plugin)
- [Chrome extension options page](https://developer.chrome.com/docs/extensions/develop/ui/options-page)
- [MDN options_ui](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/options_ui)
- [Tauri path API: appDataDir/appLogDir](https://v2.tauri.app/reference/javascript/api/namespacepath/)
- [Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
- [uv documentation](https://docs.astral.sh/uv/)
- [Python logging handlers](https://docs.python.org/3/library/logging.handlers.html)
