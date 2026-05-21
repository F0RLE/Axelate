# Integration API

Axelate exposes a local HTTP API for trusted integration modules. The API is
started by the launcher, bound to `127.0.0.1`, and protected with a per-process
token. Child module processes receive connection details through environment
variables:

- `AXELATE_HTTP_API_BASE`: local base URL, for example `http://127.0.0.1:3000`
- `AXELATE_HTTP_API_TOKEN`: bearer token for the current launcher process

Requests must include one of these auth headers:

```http
Authorization: Bearer <AXELATE_HTTP_API_TOKEN>
X-Axelate-Token: <AXELATE_HTTP_API_TOKEN>
```

## Health

`GET /v1/health`

Does not require authentication. Returns whether the local API server is alive.

## Modules

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

## AI Text

`POST /v1/ai/text`

Runs the selected or requested text AI provider through the same backend path as
launcher chat.

```json
{
  "prompt": "Summarize this message",
  "sessionId": "telegram-bot",
  "provider": "openai",
  "model": "gpt-5.4",
  "messages": [
    { "role": "user", "content": "Optional chat history" }
  ],
  "thinkingLevel": "medium",
  "maxTokens": 1024,
  "webSearch": { "enabled": false }
}
```

`provider` and `model` are optional. When omitted, the launcher uses the active
`ai_text` module selection and its selected model.

## AI Image

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

