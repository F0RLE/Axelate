# Axelate Current State

> Repository-grounded snapshot as of 2026-05-06.
> This document describes what exists now, not what the future product aspires to become.

For setup and contributor workflow, use [Getting Started](GETTING_STARTED.md) and [Development Workflow](DEVELOPMENT_WORKFLOW.md).

## One-Line Summary

Axelate is currently a Windows desktop AI shell under active development with a real Rust/Tauri backend, OpenRouter-backed chat and image flows, local runtime management, secure backend-owned settings, and several product surfaces that are ahead of the final product definition.

## Current Identity

Today the repository is closest to:

- a Windows-first AI desktop shell
- a launcher for local AI runtimes and script modules
- a BYOK cloud model client centered on OpenRouter
- a control surface for downloads, monitoring, logs, and settings

Today the repository is not yet:

- a reviewed package distribution layer
- a full package distribution platform
- a managed runtime platform
- a mature MCP-first workstation
- a finished public product with stable distribution and operations

## Current Stack

Confirmed by the repository:

- backend: Rust
- desktop runtime: Tauri v2
- frontend: vanilla TypeScript
- shared contract generation: Specta
- async runtime: Tokio
- HTTP client: reqwest
- target operating system: Windows-first

Confirmed repository posture:

- Rust owns domain logic and secure state
- TypeScript owns desktop composition and UI orchestration
- Tauri commands are used as thin adapters
- frontend-visible bindings are generated from Rust types

## Current Repository Shape

Top-level areas:

- `.github/` workflow runner, scripts, automation support
- `src/` frontend app and shell
- `src-tauri/` Rust backend, domain logic, config, commands
- `docs/` canonical English product documentation

Current backend top-level areas:

- `api/` Tauri command adapters
- `app/` bootstrap and window/tray setup
- `domain/` AI, engine, modules, system logic
- `infrastructure/` config, crypto, logging, storage
- `models/` shared types and persisted shapes

Current frontend feature areas:

- `ai/`
- `chat/`
- `console/`
- `downloads/`
- `monitoring/`
- `settings/`
- shared shell, templates, and app composition layers

## Current User-Facing Surfaces

The repository clearly contains code for these surfaces:

- chat
- AI provider and model settings
- module settings
- downloads
- console logs
- monitoring
- home page placeholder in the shared shell/templates
- shared shell, sidebar, window, modal flow

Important nuance:

- the shell has carried marketplace ambitions and related wording
- the current frontend feature set is still centered on workstation behavior, not public package distribution
- the home overview is still a placeholder surface, not a finished dashboard

## Current AI Layer

### Cloud Provider Path

The cloud path is currently centered on OpenRouter.

Confirmed behavior:

- OpenRouter-backed text and image requests
- streaming chat transport
- request-id-based stream isolation
- session-aware requests
- provider-side web search as an optional capability
- support for custom OpenRouter model IDs

Confirmed current direction from the codebase and recent fixes:

- web access is treated as a model capability toggle, not a mandatory mode
- streaming text is rendered progressively in the chat UI
- session summaries are hidden system context, not meant to leak into visible replies
- rate-limit and payment errors are separated more cleanly than before

### Image Provider Path

The repository contains API provider catalog data for image-capable providers.

Confirmed image provider families in resources:

- GPT Image
- Gemini Image
- Seedream

This means Axelate already acts as more than a text chat shell.

### Session and Chat State

Confirmed backend capabilities:

- persistent chat session storage
- load history
- clear history
- rewind last turn
- summary compaction for long conversations
- background save to disk

Confirmed frontend/backend coupling:

- frontend owns active UI request flow
- backend owns persisted session state and secure settings

## Current Local Runtime and Module Layer

The local module catalog currently includes these known entries.

### 1. `llamacpp`

- type: local
- capability: text
- engine: `llama.cpp`
- role: local LLM serving

### 2. `sdcpp`

- type: local
- capability: image
- engine: `sdcpp`
- role: lightweight local image generation

### 3. `comfyui`

- type: local
- capability: image
- state: marked `comingSoon`
- role: future high-control image workflow engine

Important current interpretation:

- ComfyUI exists in the catalog and backend support files
- it is not a stable cornerstone of the current product definition
- it should be treated as placeholder or future integration, not as core value today

### 4. Imported custom integrations

- source: user-imported folder, archive, or supported GitHub URL
- manifest: `axelate-module.toml`
- runtime: `python`, `node`, `bun`, or `binary`
- role: external workflow integration

Important current interpretation:

- there is no bundled `sample-integration` entry in the current resource catalog
- imported integrations are discovered from the user's integrations directory
- imported integrations are local code chosen by the user, not reviewed
  marketplace packages

### Confirmed Runtime Responsibilities

The backend currently handles real runtime concerns:

- installation state
- release asset selection
- download and extraction
- process start and stop
- status inspection
- PID handling
- runtime log paths split by owner: engines under `System/Runtime/Engines/Logs`, integrations under `System/Logs/Integrations`
- duplicate process cleanup

This is the strongest evidence that Axelate is already a launcher/workstation base and not just a model picker UI.

## Current Security and Ownership Model

Confirmed repository intent and implementation direction:

- sensitive values are backend-owned, not frontend-owned
- secure storage infrastructure exists
- backend is the source of truth for shared types
- process and module lifecycle live on the Rust side

Current limitation:

- the repository now moves to `Apache-2.0` for the desktop open core
- the legal and packaging split between open core and closed platform is still incomplete
- package signing, ownership sync, verified distribution, and managed execution
  layers are not separated in this repository yet

## Current Strengths

The project already has several non-trivial strengths:

- real desktop shell, not a mockup
- real backend domain logic in Rust
- real streaming architecture
- real session persistence
- real local runtime lifecycle management
- real secure-storage direction
- real provider catalog and settings layer
- real monitoring, logs, and downloads surfaces

This means Axelate is not starting from zero.

## Current Weaknesses and Product Debt

The repository also shows visible product and architecture debt.

### 1. Mixed Product Identity

The project still contains traces of several identities at once:

- chat client
- local runtime launcher
- module shell
- future marketplace
- creator platform

This weakens decision quality and UI clarity.

### 2. OpenRouter-Centric Cloud Layer

OpenRouter is a strong accelerator for the current stage, but it also means:

- cloud AI identity is still highly coupled to one provider gateway
- provider abstraction is not yet the main product story
- business differentiation cannot come from model catalog alone

### 3. Placeholder and Unfinished Surfaces

The repository still contains surfaces or ideas that are ahead of the stable product:

- home overview placeholder
- ComfyUI presence without product-ready positioning
- old wording and shell assumptions carried from earlier product framing

### 4. Incomplete Package Trust Foundation

What does not exist yet as a finished system:

- package signing service
- verified package distribution
- managed runtime orchestration
- trust and review pipeline for third-party packages
- permission prompts for package capabilities
- signed update and rollback flow

Without these, Axelate cannot honestly claim to be a trusted package platform
today.

### 5. Incomplete Trust Story On The Surface

The repository already has real trust-oriented implementation choices:

- backend-owned secrets
- Rust-owned domain logic
- runtime lifecycle on the backend side
- generated Rust-to-TypeScript bindings

But the public documentation still needs a clearer user-facing trust story:

- what the backend stores
- what modules can and cannot do
- how future MCP permissions should work
- how package trust and verification should look

## Current Market Position

Based on the repository and current capabilities, Axelate should currently be described as:

- a promising workstation prototype with real product foundations
- stronger than a simple AI chat wrapper
- weaker than a finished platform business

It already has enough substance to become a serious product if scope stays narrow.
It does not yet have enough trust infrastructure to expand safely into public
package distribution.

## What The Project Should Mean Right Now

The honest current statement is:

Axelate is an alpha-stage Windows AI workstation with local runtime orchestration, OpenRouter-backed AI flows, backend-owned secure state, and the beginnings of a package-capable desktop shell.

That is the current truth.

The project should not yet describe itself as:

- a mature package distribution platform
- a fully open ecosystem
- a trusted managed execution platform
- a finished MCP operating layer

## Current Automation State

Current GitHub automation:

- strict CI runs on `main` and `nightly`
- Dependabot opens dependency update pull requests against `nightly`
- Dependabot security updates, secret scanning, and push protection are enabled
- CodeQL scans TypeScript/JavaScript and Rust on protected branch pushes, weekly schedule, and manual dispatch
- dependency review runs on pull requests only when npm or Cargo dependency files change
- scheduled security audit runs `npm audit` and `cargo audit`
- CodeRabbit reviews pull requests targeting `nightly` and `main`
- release builds run when a `v*` tag is pushed
- release tags must match all project manifest versions
- release tags matching `v*` are protected against deletion and non-fast-forward updates

Current branch and merge settings:

- `nightly` is the default branch
- `main` and `nightly` are protected
- protected branches require the frontend and backend strict CI checks
- protected branches require linear history and resolved conversations
- protected branches reject force-push and branch deletion
- human approval and CODEOWNERS review are not required during the solo-maintainer phase
- squash merge is enabled; merge commits and rebase merges are disabled

The repository is still alpha-stage. `nightly` is where active development lands; `main` should stay release-ready.

## Current Strategic Conclusion

The current repository is strong enough to justify continued development.

The correct interpretation is:

- keep building the workstation core
- remove identity confusion
- treat public package distribution as phase two
- treat managed execution as phase three
- do not reopen scope until the desktop core is reliable and coherent
