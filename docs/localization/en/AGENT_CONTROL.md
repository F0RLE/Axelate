# Agent Control

Agent Control is Axelate's local automation layer for trusted tools such as
Codex, local CLIs, IDE assistants, and private scripts.

It is not a remote access feature. The API listens on `127.0.0.1`, uses bearer
tokens, and is meant for tools running on the same machine as the launcher.

## User Setup

Open Settings, scroll to Agent Control, and enable local agent access.
When Agent Control is disabled, user-created agent profile tokens do not
authenticate.

Create one of the local access tokens:

- `Trusted Local`: normal local automation for observing, operating, configuring,
  and drafting integrations.
- `Full Access`: manual override for development and advanced local workflows.
  Treat it like an admin token.

The full token is shown only once. Store it in the local tool that will control
Axelate. The Settings screen keeps only public profile metadata: profile name,
scopes, token prefix, creation time, last seen, and revoked state.

Users can rotate, revoke, or delete a token from Settings. Rotation creates a new
one-time token and invalidates the old token. Revocation keeps the profile record
but blocks authentication. Delete removes the profile and its pending approvals.

## Development Token

`AXELATE_AGENT_API_TOKEN` still exists for development, CI, and live tests. It is
not the normal desktop UX.

For regular `.exe`, `.app`, and Linux app launches, agents should use a token
created in the Settings UI. Do not require users to set environment variables for
normal agent control.

## Authentication

Every Agent Control route except `GET /v1/health` requires:

```http
Authorization: Bearer <agent-token>
```

The development launcher token from `AXELATE_AGENT_API_TOKEN` can also authorize
launcher-wide routes during development and tests. User-created agent profile
tokens are the intended normal path.

Module-scoped integration tokens are not launcher-wide agent tokens. They can
call their own module routes, but they cannot read global agent state or create
agent approval requests.

## Scopes

Agent profiles can have these scopes:

- `observe`: read launcher state, module lists, statuses, provider/model
  inventory, pending approvals, and sanitized console logs.
- `operate`: open launcher pages, select cards/modules, start modules, stop
  modules, restart modules, repair modules, and run AI text/image requests.
- `configure`: read and update non-secret module settings and report module
  stage/status.
- `draft-create`: create integration draft folders without installing or running
  them.
- `full-access`: user-granted local override. It satisfies all current scope
  checks, but dangerous actions should still use approval requests when they can
  install code, delete data, expose secrets, or broaden permissions.

## Approval Model

Normal `observe` and routine `operate` calls run after token authentication.

`configure` calls require the scope and are audit-logged when they mutate state.

Dangerous actions should not mutate state directly. The agent should create an
approval request with:

- agent identity from the bearer token
- action name
- target
- dry-run or diff summary
- risk label

The UI shows the pending approval. The user can approve or deny it. The initial
approval request returns `202 Accepted`; it does not mean the action has already
run.

## Audit Log

Agent-initiated actions are recorded in the backend-owned Agent Control audit
log. The Settings page does not show the full activity log; the Console has an
Agent tab for agent activity.

Audit entries include actor, action, target, result, and timestamp. They are for
operator visibility and debugging, not for storing secrets.

## Current Endpoints

### Health

`GET /v1/health`

No authentication. Returns whether the local launcher API is alive.

### Launcher State

`GET /v1/agent/state`

Requires `observe`.

Returns a safer launcher snapshot:

- selected module cards
- installed module summaries
- provider and model inventory
- engine state

Provider secrets, private files, and raw provider credentials are not returned.

### Logs

`GET /v1/agent/logs?viewId=<id>&since=0&limit=200`

Requires `observe`.

Returns recent sanitized console logs from the in-memory console store. `viewId`
is optional. `limit` defaults to `200` and is capped at `1000`.

The Agent Control API redacts common bearer tokens, API keys, passwords, tokens,
and secret assignment patterns before returning logs. It does not expose raw log
files.

### Pending Approvals

`GET /v1/agent/approvals`

Requires `observe`.

Returns pending and recent agent approval requests visible to the launcher UI.

### Create Approval Request

`POST /v1/agent/approval-requests`

Requires an agent profile token.

```json
{
    "action": "package.install",
    "target": "example-integration",
    "diff": "Would download and install package files into the integration directory.",
    "risk": "high"
}
```

Returns `202 Accepted` with the created approval request.

### Open Launcher Page

`POST /v1/launcher/open-page`

Requires `operate`.

```json
{
    "pageId": "settings"
}
```

Updates launcher UI state and asks the frontend to open the page. Page ids must
be simple ASCII ids.

### Select Module Card

`POST /v1/launcher/select-module`

Requires `operate`.

```json
{
    "category": "ai_text",
    "moduleId": "custom-text"
}
```

Supported categories are `ai_text`, `ai_image`, and `services`.

### Modules

`GET /v1/modules`

Requires `observe`.

Launcher-wide agents see installed module metadata. Module-scoped integration
tokens only see their own module. Use `/v1/agent/state` when an agent only needs
the safer launcher snapshot.

`GET /v1/modules/{moduleId}/status`

Requires `observe`.

`GET /v1/modules/{moduleId}/context`

Requires `observe`.

`POST /v1/modules/{moduleId}/start`

Requires `operate`.

`POST /v1/modules/{moduleId}/stop`

Requires `operate`.

`POST /v1/modules/{moduleId}/restart`

Requires `operate`.

`POST /v1/modules/{moduleId}/repair`

Requires `operate`.

Repair stops the module, rebuilds the launcher-managed dependency environment
for Python, Node, and Bun modules, then starts the module again. For modules that
use their own lifecycle commands, repair behaves like a controlled restart. It
does not delete the integration folder, settings, logs, or module runtime data.

When an agent starts or restarts a runtime module, Axelate syncs the selected
launcher card where possible so the UI reflects the running module. Repair uses
the same selection sync after a successful start.

### Module Settings

`GET /v1/modules/{moduleId}/settings`

Requires `configure`.

`PUT /v1/modules/{moduleId}/settings`

Requires `configure` and writes an audit entry.

`PATCH /v1/modules/{moduleId}/settings`

Requires `configure` and writes an audit entry.

Agents should use these routes instead of editing Axelate config files directly.

### Integration Drafts

`POST /v1/integration-drafts`

Requires `draft-create`.

```json
{
    "id": "my-draft-tool",
    "name": "My Draft Tool",
    "runtimeKind": "python",
    "entry": "src/main.py",
    "description": "Optional short description"
}
```

Creates a draft folder under Axelate's managed runtime drafts directory and
writes `axelate-module.toml`, `README.md`, and a minimal entry file. Supported
runtime kinds are `python`, `node`, and `bun`.

This endpoint does not install the draft, does not run code, and does not write
into the installed integrations directory. The user or a later reviewed flow must
import/install the draft explicitly.

### AI Requests

`POST /v1/ai/text`

Requires `operate`.

```json
{
    "prompt": "Summarize the current launcher state.",
    "provider": "custom-text",
    "model": "gpt-5.5",
    "thinkingLevel": "medium",
    "webSearch": { "enabled": false }
}
```

`POST /v1/ai/image`

Requires `operate`.

If `provider` is omitted, Axelate uses the active launcher selection. If
`provider` is provided, Axelate validates and uses that provider for this request
without changing the visible selected card.

## Agent Rules

Agents should:

- use the documented HTTP API, not UI scraping
- use explicit `open-page` and `select-module` calls instead of guessing UI state
- read sanitized console logs through `/v1/agent/logs`, not by opening raw log
  files
- never request provider secrets through the API
- create approval requests for install, delete, update, raw logs, secret changes,
  filesystem permissions, and network permission changes
- keep tokens local and rotate them if exposed

Agents should not:

- read Axelate private files directly
- store tokens in the repository
- assume a fixed local port
- treat `Full Access` as permission to skip user-visible approval for dangerous
  mutations
- use MCP as a bypass around scopes, audit, or approvals

## MCP Direction

MCP should come later as an adapter over this same Agent Control API.

An MCP server should not receive separate trust. It should call the same local
HTTP endpoints, use the same agent tokens, follow the same scopes, write the
same audit entries, and create the same approval requests for risky work.
