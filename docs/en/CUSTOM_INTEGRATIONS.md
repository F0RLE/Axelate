# Custom Integrations

Axelate integrations are folders with an `axelate-module.toml` manifest. The
launcher can import a folder, a local archive, or a GitHub repository/archive URL.
Archives may be `.zip`, `.tar.gz`, `.tgz`, or `.7z`.

For a guided development flow, use [Integration Development](INTEGRATION_DEVELOPMENT.md).

## Minimal Layout

```text
my-integration/
  axelate-module.toml
  README.md
  requirements.txt
  src/
    main.py
  settings-ui/
    index.html
```

## Manifest

```toml
api_version = "1"
id = "my-integration"
name = "My Integration"
version = "0.1.0"
description = "Connects my product to Axelate."
author = "Your Name"
type = "service"
icon = "⚙"
readme = "README.md"
settings_ui = "settings-ui/index.html"

[runtime]
kind = "python"
version = "3.11"
entry = "src/main.py"
dependencies = "requirements.txt"
```

Rules:

- `id` may contain only letters, numbers, `-`, and `_`.
- `type` should be `service` for launcher integrations.
- `runtime.entry` and `runtime.dependencies` are paths relative to the module
  folder.
- Do not ship `.venv`, `node_modules`, caches, logs, or downloaded runtimes.

## Launcher API

Launcher-managed script-runtime integrations receive:

- `AXELATE_SDK_VERSION`
- `AXELATE_HTTP_API_BASE`
- `AXELATE_HTTP_API_TOKEN`
- `AXELATE_RUNTIME_DIR`
- `AXELATE_MODULE_DIR`
- `AXELATE_MODULE_RUNTIME_DIR`
- `AXELATE_MODULE_LOG_DIR`
- `AXELATE_MODULE_ID`

Use the local HTTP API from [LAUNCHER_SDK.md](./LAUNCHER_SDK.md) to call AI,
read and save integration settings, report stages, and control integration
status. Store integration-owned runtime files under `AXELATE_MODULE_RUNTIME_DIR`
and logs under `AXELATE_MODULE_LOG_DIR`; do not write generated files into the
imported integration folder.

## Current Trust Limits

Custom integrations are local code imported by the user. The current launcher can
validate the manifest, isolate settings/runtime/log folders, issue scoped local
API tokens, and remove imported files. It does not yet provide marketplace
signing, verified publisher identity, install-time permission review, or managed
remote execution. Treat manually imported integrations as code you chose to run.

## Example

Use [Axelate Telegram Parser](https://github.com/F0RLE/Axelate-telegram-parser)
as a working integration structure.
