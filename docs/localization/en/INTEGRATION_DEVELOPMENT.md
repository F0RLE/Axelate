# Integration Development

> Build a product integration that uses Axelate AI, settings, logs, and runtime
> folders without depending on launcher internals.

## Fast Path

Create a starter integration:

```bash
npm run integration:new -- ./my-integration --id my-integration --name "My Integration"
npm run integration:doctor -- ./my-integration
```

Then import the folder in the launcher integrations screen and launch it.
Use `--runtime node` or `--runtime bun` when the integration entrypoint is
JavaScript instead of Python.

For an existing app, keep the app code in your integration folder, declare its
entrypoint in `axelate-module.toml`, and use the launcher-provided environment
variables at process start. Store generated state in
`AXELATE_MODULE_RUNTIME_DIR`, call `/v1/ai/text` or `/v1/ai/image` through the
local API, then run `integration:doctor` before importing the folder.

## Repository Helpers

- `npm run integration:new -- <folder>` creates a minimal Python integration.
  Add `--runtime node` or `--runtime bun` for JavaScript runtimes.
- `npm run integration:doctor -- <folder>` validates `axelate-module.toml`,
  entry files, settings UI, dependency paths, and common generated folders that
  should not be shipped.
- `docs/examples/integrations/python-ai-tool/` is the smallest working example.
- `docs/examples/sdk/python/axelate_sdk.py` and
  `docs/examples/sdk/javascript/axelate-client.mjs` are small copyable
  client helpers for the local HTTP API.
- `docs/examples/sdk/browser/axelate-settings-bridge.js` is a copyable
  helper for custom settings UI iframe messaging.

These helpers are developer tools. The runtime contract is still the local HTTP
API documented in [Integration API](INTEGRATION_API.md).

## Integration Layout

```text
my-integration/
  axelate-module.toml
  README.md
  src/
    main.py
  settings-ui/
    index.html
```

The manifest must declare a launcher-managed runtime:

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

Supported runtime kinds are `python`, `node`, `bun`, and `binary`.

## Runtime Contract

When Axelate launches a script-runtime integration it sets:

- `AXELATE_INTEGRATION_API_VERSION`
- `AXELATE_HTTP_API_BASE`
- `AXELATE_HTTP_API_TOKEN`
- `AXELATE_MODULE_ID`
- `AXELATE_MODULE_DIR`
- `AXELATE_RUNTIME_DIR`
- `AXELATE_MODULE_RUNTIME_DIR`
- `AXELATE_MODULE_LOG_DIR`

Use those values at process start. Do not hardcode ports or data paths.

## Calling AI

Minimal Python call:

```python
from axelate_sdk import AxelateClient

client = AxelateClient()
settings = client.settings()
reply = client.ai_text(settings.get("prompt", "Write a short status update."))
print(reply)
```

Minimal JavaScript call:

```js
import { AxelateClient } from './axelate-client.mjs';

const client = new AxelateClient();
const settings = await client.settings();
const reply = await client.aiText(settings.prompt ?? 'Write a short status update.');
console.log(reply);
```

## Settings UI

If `settings_ui` points to an HTML file or a directory with `index.html`, the
launcher opens it in a sandboxed settings host.

The iframe protocol is:

- post `{ channel: "axelate:module-settings", type: "module-ready" }`
- wait for `host-ready`, which includes `settings` and `context`
- post `module-rendered` when the UI is ready
- save settings with a message whose `method` is `saveSettings`

Use `docs/examples/integrations/python-ai-tool/settings-ui/index.html` and
`docs/examples/integrations/python-ai-tool/settings-ui/axelate-settings-bridge.js`
as the current reference.

## Development Loop

1. Scaffold or copy the example.
2. Run `integration:doctor`.
3. Import the folder in Axelate.
4. Launch the card.
5. Check integration logs from the launcher console/logs UI.
6. Keep generated data in `AXELATE_MODULE_RUNTIME_DIR`.
7. Keep shipped source clean: no `.venv`, `node_modules`, caches, logs, or
   downloaded runtimes.

## Trust Rule

Imported integrations are local code chosen by the user. They are not reviewed,
signed, or sandboxed packages yet.
