# Launcher SDK

This guide describes the stable contract external integrations use to control
Axelate. The contract is language-neutral: every integration talks to the
launcher through a local HTTP API. Language SDKs can wrap this contract later,
but the HTTP API is the source of truth.

## Runtime Contract

Axelate starts a local API server on `127.0.0.1` when the launcher starts. The
server is available only on the local machine and requires a per-process token.

Launcher-managed integration processes receive these environment variables:

- `AXELATE_SDK_VERSION`: local launcher integration API version, currently `1`
- `AXELATE_HTTP_API_BASE`: local base URL, for example `http://127.0.0.1:3000`
- `AXELATE_HTTP_API_TOKEN`: bearer token for the current launcher process
- `AXELATE_RUNTIME_DIR`: shared launcher runtime directory
- `AXELATE_MODULE_DIR`: read-only integration installation directory
- `AXELATE_MODULE_RUNTIME_DIR`: writable runtime directory reserved for the integration
- `AXELATE_MODULE_LOG_DIR`: writable log directory reserved for the integration
- `AXELATE_MODULE_ID`: current integration id

External tools that are not launched by Axelate need the same two values from
the user or from their own launcher integration flow.

Script integrations declare their runtime in `axelate-module.toml`. Legacy top-level
`entry` and `dependencies` fields are not supported.

```toml
[runtime]
kind = "python" # python | node | bun | binary
version = "3.14"
entry = "src/main.py"
dependencies = "requirements.txt"
```

The launcher installs dependencies into its managed runtime under
`AxelateData/System/Runtime/<Runtime>/envs/<runtime-version>/<integration-id>`.
Python uses `uv` and `requirements.txt`. Node and Bun use the declared package
manager and a package manifest outside the integration directory. Integrations must not
ship or write `.venv`, `node_modules`, caches, logs, or downloaded runtime
dependencies inside the integration directory.

## Authentication

Every endpoint except `GET /v1/health` requires one of these headers:

```http
Authorization: Bearer <AXELATE_HTTP_API_TOKEN>
X-Axelate-Token: <AXELATE_HTTP_API_TOKEN>
```

Prefer `Authorization: Bearer ...` for new clients.

## Client Rules

- Treat `AXELATE_HTTP_API_BASE` and `AXELATE_HTTP_API_TOKEN` as runtime values.
- Do not hardcode the port. The launcher can choose any free port in its local
  range.
- Do not store the token permanently. It changes between launcher processes.
- Send and receive JSON.
- Use `/v1` endpoints only; unversioned endpoints are not public API.
- Read and save integration settings through `/v1/modules/{moduleId}/settings`.
  Do not read or write Axelate's internal `module_settings.json` directly.
- Write temporary files, caches, and generated state to `AXELATE_MODULE_RUNTIME_DIR`.
  Write logs to `AXELATE_MODULE_LOG_DIR`.
- If a request specifies an AI `provider`, the launcher updates the matching UI
  card selection before running the request.

## Quick Start

### curl

```bash
curl -X POST "$AXELATE_HTTP_API_BASE/v1/ai/text" \
  -H "Authorization: Bearer $AXELATE_HTTP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"llamacpp","prompt":"Write a short status update"}'
```

### PowerShell

```powershell
$headers = @{
  Authorization = "Bearer $env:AXELATE_HTTP_API_TOKEN"
}

Invoke-RestMethod `
  -Method Post `
  -Uri "$env:AXELATE_HTTP_API_BASE/v1/ai/text" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    provider = "llamacpp"
    prompt = "Write a short status update"
  } | ConvertTo-Json)
```

### JavaScript

```js
const baseUrl = process.env.AXELATE_HTTP_API_BASE;
const token = process.env.AXELATE_HTTP_API_TOKEN;
const moduleId = process.env.AXELATE_MODULE_ID;

const response = await fetch(`${baseUrl}/v1/ai/text`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    provider: "llamacpp",
    prompt: "Write a short status update",
  }),
});

const result = await response.json();

const settingsResponse = await fetch(`${baseUrl}/v1/modules/${moduleId}/settings`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { settings } = await settingsResponse.json();
```

### Python

```python
import os
import requests

base_url = os.environ["AXELATE_HTTP_API_BASE"]
token = os.environ["AXELATE_HTTP_API_TOKEN"]
module_id = os.environ["AXELATE_MODULE_ID"]
headers = {"Authorization": f"Bearer {token}"}

response = requests.post(
    f"{base_url}/v1/ai/text",
    headers=headers,
    json={
        "provider": "llamacpp",
        "prompt": "Write a short status update",
    },
    timeout=120,
)
result = response.json()

settings = requests.get(
    f"{base_url}/v1/modules/{module_id}/settings",
    headers=headers,
    timeout=30,
).json()["settings"]
```

## Endpoints

### Health

`GET /v1/health`

Does not require authentication. Returns whether the local API server is alive.

### Integrations

`GET /v1/modules`

Returns known integrations with launcher status, selected state, category, install
state, and metadata.

`GET /v1/modules/{moduleId}/status`

Returns one integration status.

`GET /v1/modules/{moduleId}/context`

Returns the stable runtime context for an installed integration.

```json
{
  "ok": true,
  "apiVersion": "1",
  "moduleId": "my-integration",
  "moduleDir": "C:\\Users\\...\\AxelateData\\System\\Integrations\\my-integration",
  "runtimeDir": "C:\\Users\\...\\AxelateData\\System\\Runtime",
  "moduleRuntimeDir": "C:\\Users\\...\\AxelateData\\System\\Runtime\\Integrations\\my-integration",
  "moduleLogDir": "C:\\Users\\...\\AxelateData\\System\\Logs\\Integrations\\my-integration",
  "httpApiBase": "http://127.0.0.1:3000"
}
```

`moduleDir` is for reading shipped integration files. Runtime output belongs in
`moduleRuntimeDir`, not in the integration folder.

`GET /v1/modules/{moduleId}/settings`

Returns the JSON settings object owned by the integration.

`PUT /v1/modules/{moduleId}/settings`

Replaces the integration settings object.

```json
{
  "chatId": "12345",
  "enabled": true
}
```

`PATCH /v1/modules/{moduleId}/settings`

Merges the request JSON object into the existing integration settings object.

`POST /v1/modules/{moduleId}/stage`

Reports the current user-visible stage of a running integration. The launcher
emits `module-stage-changed` for UI surfaces and writes the stage to logs.

```json
{
  "stage": "parser.fetch",
  "label": "Fetching external data",
  "details": { "topics": 3 },
  "progress": 0.35
}
```

`stage` is a stable machine-readable stage id. `label` is the human-readable
current action. `details` and `progress` are optional.

`POST /v1/modules/{moduleId}/start`

Starts an integration or long-running module script through the launcher module
controller.

`POST /v1/modules/{moduleId}/stop`

Stops the running module script.

`POST /v1/modules/{moduleId}/restart`

Restarts the module script.

### AI Text

`POST /v1/ai/text`

Runs the selected or requested text AI provider through the same backend path as
launcher chat.

```json
{
  "prompt": "Summarize this message",
  "sessionId": "sample-integration",
  "provider": "openai",
  "model": "gpt-5.5",
  "messages": [{ "role": "user", "content": "Optional chat history" }],
  "thinkingLevel": "medium",
  "maxTokens": 1024,
  "webSearch": { "enabled": false }
}
```

`provider` and `model` are optional. When omitted, the launcher uses the active
`ai_text` module selection and its selected model.

When `provider` is provided, the launcher also updates the visual `ai_text`
selection card so the UI matches the integration request.

### AI Image

`POST /v1/ai/image`

Runs image generation through the selected or requested image AI provider.

```json
{
  "prompt": "Pixel art launcher icon",
  "provider": "openai",
  "model": "image-model-id",
  "width": 1024,
  "height": 1024,
  "steps": 30
}
```

`provider` and `model` are optional. When omitted, the launcher uses the active
`ai_image` module selection and its selected model.

When `provider` is provided, the launcher also updates the visual `ai_image`
selection card so the UI matches the integration request.
