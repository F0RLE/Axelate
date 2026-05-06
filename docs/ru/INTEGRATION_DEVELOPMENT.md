# Разработка интеграций

> Как подключить свой продукт к Axelate, использовать AI лаунчера, настройки,
> логи и runtime-папки без доступа к внутренним файлам приложения.

## Быстрый старт

Создать шаблон интеграции:

```bash
npm run integration:new -- ./my-integration --id my-integration --name "My Integration"
npm run integration:doctor -- ./my-integration
```

После этого импортируй папку на странице интеграций в лаунчере и запусти
карточку.

## Инструменты в репозитории

- `npm run integration:new -- <folder>` создает минимальную Python-интеграцию.
- `npm run integration:doctor -- <folder>` проверяет `axelate-module.toml`,
  entry-файлы, settings UI, dependency paths и типичные сгенерированные папки,
  которые нельзя поставлять.
- `docs/examples/integrations/python-ai-tool/` - минимальный рабочий пример.
- `docs/examples/sdk/python/axelate_sdk.py` и
  `docs/examples/sdk/javascript/axelate-client.mjs` - маленькие helper
  клиенты, которые можно скопировать в свой проект.
- `docs/examples/sdk/browser/axelate-settings-bridge.js` - helper для
  iframe-протокола custom settings UI.

Главный контракт все равно описан в [Launcher SDK](../en/LAUNCHER_SDK.md)
(англ., в `docs/en/LAUNCHER_SDK.md`): это локальный HTTP API лаунчера.

## Структура интеграции

```text
my-integration/
  axelate-module.toml
  README.md
  src/
    main.py
  settings-ui/
    index.html
```

Минимальный manifest:

```toml
api_version = "1"
id = "my-integration"
name = "My Integration"
version = "0.1.0"
type = "service"
settings_ui = "settings-ui/index.html"

[runtime]
kind = "python"
version = "3.11"
entry = "src/main.py"
```

Поддерживаемые runtime: `python`, `node`, `bun`, `binary`.

## Runtime-контракт

Когда Axelate запускает script-runtime интеграцию, он передает:

- `AXELATE_SDK_VERSION`
- `AXELATE_HTTP_API_BASE`
- `AXELATE_HTTP_API_TOKEN`
- `AXELATE_MODULE_ID`
- `AXELATE_MODULE_DIR`
- `AXELATE_RUNTIME_DIR`
- `AXELATE_MODULE_RUNTIME_DIR`
- `AXELATE_MODULE_LOG_DIR`

Используй эти значения при старте процесса. Не хардкодь порт и пути.

## Вызов AI

Python:

```python
from axelate_sdk import AxelateClient

client = AxelateClient()
settings = client.settings()
reply = client.ai_text(settings.get("prompt", "Write a short status update."))
print(reply)
```

JavaScript:

```js
import { AxelateClient } from './axelate-client.mjs';

const client = new AxelateClient();
const settings = await client.settings();
const reply = await client.aiText(settings.prompt ?? 'Write a short status update.');
console.log(reply);
```

## Settings UI

Если `settings_ui` указывает на HTML-файл или папку с `index.html`, лаунчер
открывает его в sandboxed host.

Протокол iframe:

- отправить `{ channel: "axelate:module-settings", type: "module-ready" }`
- дождаться `host-ready`, где есть `settings` и `context`
- отправить `module-rendered`, когда интерфейс готов
- сохранить настройки сообщением с `method: "saveSettings"`

Текущий пример:
`docs/examples/integrations/python-ai-tool/settings-ui/index.html` и
`docs/examples/integrations/python-ai-tool/settings-ui/axelate-settings-bridge.js`.

## Цикл разработки

1. Создай шаблон или скопируй пример.
2. Запусти `integration:doctor`.
3. Импортируй папку в Axelate.
4. Запусти карточку.
5. Смотри логи интеграции в лаунчере.
6. Runtime-файлы пиши в `AXELATE_MODULE_RUNTIME_DIR`.
7. Не поставляй `.venv`, `node_modules`, caches, logs и скачанные runtime.

## Правило доверия

Импортированные интеграции - это локальный код, который пользователь сам решил
запустить. Сейчас это не проверенные, не подписанные и не выполняемые в
песочнице пакеты.
