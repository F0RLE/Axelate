# Launcher SDK

This guide describes the stable contract external integrations use to control
Axelate. The contract is language-neutral: every integration talks to the
launcher through a local HTTP API. Language SDKs can wrap this contract later,
but the HTTP API is the source of truth.

## Runtime Contract

Axelate starts a local API server on `127.0.0.1` when the launcher starts. The
server is available only on the local machine and requires a per-process token.

Launcher-managed module processes receive these environment variables:

- `AXELATE_HTTP_API_BASE`: local base URL, for example `http://127.0.0.1:3000`
- `AXELATE_HTTP_API_TOKEN`: bearer token for the current launcher process

External tools that are not launched by Axelate need the same two values from
the user or from their own launcher integration flow.

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
```

### Python

```python
import os
import requests

base_url = os.environ["AXELATE_HTTP_API_BASE"]
token = os.environ["AXELATE_HTTP_API_TOKEN"]

response = requests.post(
    f"{base_url}/v1/ai/text",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "provider": "llamacpp",
        "prompt": "Write a short status update",
    },
    timeout=120,
)
result = response.json()
```

## Endpoints

### Health

`GET /v1/health`

Does not require authentication. Returns whether the local API server is alive.

### Modules

`GET /v1/modules`

Returns known modules with launcher status, selected state, category, install
state, and metadata.

`GET /v1/modules/{moduleId}/status`

Returns one module status.

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
  "sessionId": "telegram-bot",
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
