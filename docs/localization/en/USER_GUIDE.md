# Axelate User Guide

> Short guide for using the current desktop app. This is not a developer setup
> guide; for source builds use [Getting Started](GETTING_STARTED.md).

## What Axelate Does Today

Axelate is a Windows-first AI workstation. It can:

- use BYOK (Bring Your Own Key) cloud AI providers through the launcher UI
- run chat and image requests
- manage local AI engines such as `llamacpp` and `sdcpp`
- import local integrations from folders, archives, or supported URLs
- show downloads, runtime logs, settings, and system monitoring in one shell

It is not yet a reviewed package store, a managed remote execution platform, or
a finished MCP control layer.

## First Launch

On first launch:

1. Open Settings.
2. Choose the UI language and theme.
3. Add the provider key you want to use.
4. Select an AI provider and model.
5. Optionally install a local engine for text or image generation.

Provider keys are stored through the backend secure-storage path. The UI should
show whether a key exists without exposing the full secret.

## Chat And Images

Use the chat surface for text conversations and image attachments. If a provider
or local engine fails, the error should appear as a notification or status
message, not as a fake assistant reply.

For image generation, select an image-capable provider or local image engine in
the AI settings surface before sending the request.

## Local Engines

The current built-in local engines are:

- `llamacpp` for text generation
- `sdcpp` for image generation
- `comfyui` as a future/experimental image workflow entry

Engine downloads and starts are backend-owned. Use the launcher controls to
install, launch, stop, delete, and inspect logs instead of editing runtime files
by hand.

## Integrations

Custom integrations are local projects with an `axelate-module.toml` manifest.
The launcher can import:

- a folder
- a local archive
- a supported GitHub repository or archive URL

Imported integrations are code you chose to run. They are not reviewed or signed
packages yet. Use the card actions to launch, stop, open, or delete an
integration.

## Data And Logs

Axelate keeps runtime data under its application data directory, split by
purpose:

- integration install folders
- integration runtime folders
- integration logs
- engine runtime folders
- launcher logs and settings

Prefer launcher actions for deleting engines or integrations. Manual deletion
can leave stale UI state until the launcher refreshes its module list.

## Troubleshooting

If something fails:

- check the notification/status message first
- open the console/logs surface
- stop and launch the engine or integration again
- verify that required provider keys still exist
- delete and reinstall a broken local engine only after checking logs

For source-development problems, use [Development Workflow](DEVELOPMENT_WORKFLOW.md).

## Trust Limits

Current local integrations are not sandboxed packages. Do not import projects you
would not normally run on your machine.

For the full trust model, see [Trust Model](TRUST_MODEL.md).
