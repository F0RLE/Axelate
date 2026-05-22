# Integration API

This guide describes the current versioned contract launcher-managed
integrations use to talk to Axelate. The contract is language-neutral: every
integration talks to the launcher through a local HTTP API. Language clients can
wrap this contract later, but the HTTP API is the source of truth.

This API is also the base for Agent Control. Module-scoped integration tokens
remain conservative. Trusted local agent profiles use separate launcher-wide
tokens with scopes, audit logging, and approval requests for risky work. See
[Agent Control](AGENT_CONTROL.md) for the agent-facing contract.

For scaffolding, validation, and examples, start with
[Integration Development](INTEGRATION_DEVELOPMENT.md).

## Runtime Contract

Axelate starts a local API server on `127.0.0.1` when the launcher starts. The
server is available only on the local machine and requires a launcher-issued
runtime token.

Launcher-managed script-runtime integration processes receive these environment
variables:

- `AXELATE_INTEGRATION_API_VERSION`: local launcher integration API version,
  currently `1`
- `AXELATE_HTTP_API_BASE`: local base URL, for example `http://127.0.0.1:3000`
- `AXELATE_HTTP_API_TOKEN`: bearer token issued by `apply_process_env` through
  `issue_module_api_token` and scoped to this integration. It authorizes shared
  endpoints and only this integration's own `/v1/modules/{moduleId}/...` routes;
  `ensure_module_route_owner` rejects other module routes with `403`.
- `AXELATE_RUNTIME_DIR`: shared launcher runtime directory
- `AXELATE_MODULE_DIR`: read-only integration installation directory
- `AXELATE_MODULE_RUNTIME_DIR`: writable runtime directory reserved for the integration
- `AXELATE_MODULE_LOG_DIR`: writable log directory reserved for the integration
- `AXELATE_MODULE_ID`: current integration id

Standalone tools that are not launched by Axelate are not the primary public
contract yet. They should use a launcher-managed integration flow instead of
persisting or guessing local API credentials.

External agents should not scrape the desktop UI or read Axelate data files
directly. The supported path is a launcher-issued agent profile token and
documented `/v1` endpoints.

For local development and explicit agent testing, Axelate also accepts
`AXELATE_AGENT_API_TOKEN` as a launcher-wide bearer token when the launcher
process is started with that environment variable. Use a high-entropy temporary
value and do not persist it in the repository. Normal desktop usage should create
tokens from Settings instead.

Script integrations declare their runtime in `axelate-module.toml`.

```toml
[runtime]
kind = "python" # python | node | bun | binary
version = "3.11"
entry = "src/main.py"
dependencies = "requirements.txt"
```

The launcher installs dependencies into its managed runtime under
`AxelateData/System/Runtime/<Runtime>/envs/<runtime-version>/<integration-id>`.
Python uses `uv` and `requirements.txt`. Node and Bun use the declared package
manager and a package manifest outside the integration directory. Integrations must not
ship or write `.venv`, `node_modules`, caches, logs, or downloaded runtime
dependencies inside the integration directory.

Import URLs accepted by the launcher must use `https://`, except localhost
development URLs. GitHub repository-root URLs may be resolved to branch archives;
direct archive URLs are downloaded directly.

## Authentication

Every endpoint except `GET /v1/health` requires bearer-token authentication:

```http
Authorization: Bearer <AXELATE_HTTP_API_TOKEN>
```

Module-scoped tokens can access shared AI endpoints and only that module's own
`/v1/modules/{moduleId}/...` routes. They are not durable credentials and should
not be stored outside the running process.

Agent profile tokens do not reuse module tokens. They have their own scopes:

- `observe`: read health, status, module lists, and sanitized console logs
- `operate`: open launcher pages, select cards, start, stop, restart, repair, and
  run AI requests
- `configure`: update settings after user approval where needed
- `draft-create`: create integration draft folders without installing or running
  them
- `full-access`: user-granted local override for advanced workflows

Secrets stay out of agent responses.

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
- If a request specifies an AI `provider`, the launcher validates and uses that
  provider for the request only. It does not change the user's visual card
  selection. Omit `provider` to use the active launcher selection.

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
    method: 'POST',
    headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        provider: 'llamacpp',
        prompt: 'Write a short status update',
    }),
});

const result = await response.json();

const modulePathId = encodeURIComponent(moduleId);
const settingsResponse = await fetch(`${baseUrl}/v1/modules/${modulePathId}/settings`, {
    headers: { Authorization: `Bearer ${token}` },
});
const { settings } = await settingsResponse.json();
```

### Python

```python
import os
import urllib.parse
import requests

base_url = os.environ["AXELATE_HTTP_API_BASE"]
token = os.environ["AXELATE_HTTP_API_TOKEN"]
module_id = os.environ["AXELATE_MODULE_ID"]
module_path_id = urllib.parse.quote(module_id, safe="")
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
    f"{base_url}/v1/modules/{module_path_id}/settings",
    headers=headers,
    timeout=30,
).json()["settings"]
```

## Endpoints

### Health

`GET /v1/health`

Does not require authentication. Returns whether the local API server is alive.

### Agent Control

The current `/v1/modules` and `/v1/ai` endpoints are used by both
launcher-managed integrations and trusted local agents. Launcher-wide agent
state uses an agent profile token, not a module-scoped integration token.

`GET /v1/agent/state`

Returns a safer launcher snapshot:

- selected module cards
- installed module summaries without module paths or settings
- provider/model inventory without secrets or provider endpoints
- current engine state

Module-scoped integration tokens cannot call this route.

`GET /v1/agent/logs?viewId=engine:llama-cpp&since=0&limit=200`

Returns recent sanitized console logs from memory. `viewId` is optional; omit it
to read the combined console stream. `limit` defaults to 200 and is capped at
1000. Raw log files are not exposed through this route.

Module-scoped integration tokens cannot call this route.

`GET /v1/agent/approvals`

Returns pending and recent approval requests.

`POST /v1/agent/approval-requests`

Creates a pending approval request for dangerous work. The request should include
an action, target, dry-run or diff text, and risk label. It returns `202
Accepted`; it does not run the requested action.

`POST /v1/launcher/open-page`

Requires `operate`. Opens a launcher page by id.

`POST /v1/launcher/select-module`

Requires `operate`. Selects a visible card/module for `ai_text`, `ai_image`, or
`services`.

`POST /v1/integration-drafts`

Requires `draft-create`. Creates a local draft folder with a manifest, README,
and minimal runtime entry file. It does not install or run the draft.

Mutating operations should stay behind explicit scopes and user approval where
the action can install code, delete data, expose logs, or change credentials.

For the complete Agent Control contract, see [AGENT_CONTROL.md](AGENT_CONTROL.md).

### Integrations

`GET /v1/modules`

Returns installed integrations with launcher status, category, install state, and
metadata. A launcher-wide token can see all installed integrations. A
module-scoped token only sees the integration that received the token. Agents
that need a safer launcher snapshot should use `/v1/agent/state`.

`GET /v1/modules/{moduleId}/status`

Returns one integration status.

`GET /v1/modules/{moduleId}/context`

Returns the stable runtime context for an installed integration.

```json
{
    "ok": true,
    "apiVersion": "1",
    "moduleId": "my-integration",
    "moduleDir": "{AXELATE_DATA_DIR}/System/Integrations/my-integration",
    "runtimeDir": "{AXELATE_DATA_DIR}/System/Runtime",
    "moduleRuntimeDir": "{AXELATE_DATA_DIR}/System/Runtime/Integrations/my-integration",
    "moduleLogDir": "{AXELATE_DATA_DIR}/System/Logs/Integrations/my-integration",
    "httpApiBase": "http://127.0.0.1:3000"
}
```

`moduleDir` is for reading shipped integration files. Runtime output belongs in
`moduleRuntimeDir`, not in the integration folder. Treat these paths as
platform-specific strings and use path utilities such as `path.join` and
`path.sep` instead of hardcoded separators.

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

`POST /v1/modules/{moduleId}/repair`

Stops the module, rebuilds the launcher-managed dependency environment for
Python, Node, and Bun modules, then starts the module again. For modules with
custom lifecycle commands, repair behaves like a controlled restart. It does not
delete the integration folder, settings, logs, or module runtime data.

### AI Text

`POST /v1/ai/text`

Runs the selected or requested text AI provider through the same backend path as
launcher chat.

```json
{
    "prompt": "Summarize this message",
    "sessionId": "my-integration",
    "provider": "gpt",
    "model": "gpt-5.5",
    "messages": [{ "role": "user", "content": "Optional chat history" }],
    "thinkingLevel": "medium",
    "maxTokens": 1024,
    "webSearch": { "enabled": false }
}
```

`provider` and `model` are optional. When omitted, the launcher uses the active
`ai_text` module selection and its selected model.

When `provider` is provided, the launcher validates that provider and runs this
request against it without changing the user's active `ai_text` selection.

### AI Image

`POST /v1/ai/image`

Runs image generation through the selected or requested image AI provider.

```json
{
    "prompt": "Pixel art launcher icon",
    "provider": "gpt-image",
    "model": "openai/gpt-5-image",
    "width": 1024,
    "height": 1024,
    "steps": 30
}
```

`provider` and `model` are optional. When omitted, the launcher uses the active
`ai_image` module selection and its selected model.

When `provider` is provided, the launcher validates that provider and runs this
request against it without changing the user's active `ai_image` selection.
