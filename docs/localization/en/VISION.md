# Axelate Vision

> Product direction as of 2026-05-06.
> Planning document only. Use `CURRENT_STATE.md`, `GETTING_STARTED.md`, and
> `DEVELOPMENT_WORKFLOW.md` for the repository as it works today.

## Product Name

- Short name: Axelate
- Working full name: Axelate Workstation Platform
- Current category: Windows-first AI workstation and local integration runtime
- Future category: trusted desktop control plane for local AI, BYOK cloud models,
  MCP tools, and packaged AI integrations

## Product Sentence

Axelate is a desktop AI workstation that installs and controls local AI engines,
connects BYOK cloud providers, and lets user-installed integrations run against a
shared local AI runtime, settings, logs, and API surface.

## Why This Product Should Exist

The AI desktop market already has chat clients, model runners, agent shells, and
web dashboards. What is still weak is the layer that makes practical AI tools
easy to install, run, observe, repair, and trust on a user's machine.

Axelate should exist to be that layer.

The product should not compete as "another chat UI". It should compete as the
trusted operating surface for local and hybrid AI work.

## Product Thesis

Axelate wins only if it stays narrow and honest:

- one desktop shell for local and cloud AI work
- one integration runtime for user-installed AI tools
- one local API surface for chat, image, settings, status, logs, and lifecycle
- one trust model for secrets, permissions, runtime folders, updates, and future
  verified packages

Axelate loses if it tries to become:

- a generic social marketplace
- a pure web dashboard clone
- a random unsafe script runner
- a giant everything-app before the workstation core is reliable

## Target Users

- Power users who switch between local runtimes and cloud models.
- Developers who want their tools to use local or BYOK AI without rebuilding
  engine setup, provider routing, settings, logs, and runtime management.
- Small studios that need one desktop surface for text, image, automation, and
  tool-backed AI workflows.

## Core Product Definition

### 1. Desktop Workstation

The desktop app is the main product.

It should provide:

- local engine install, update, start, stop, and health status
- cloud provider selection and model routing
- OpenAI-compatible local API support where practical
- integration import from folders, archives, and trusted URLs
- backend-owned credential storage
- integration settings, runtime folders, and logs
- downloads, console logs, monitoring, and repair actions

The workstation core should stay Windows-first until the product model is proven.

### 2. Integration Runtime

Integrations should be folders or packages with a manifest and runtime contract.

The launcher should provide:

- manifest validation
- runtime dependency setup
- scoped local API tokens
- per-integration settings
- per-integration runtime and log directories
- start, stop, restart, status, and stage reporting
- predictable import, update, removal, and external-folder-missing behavior

This layer is the product wedge. It turns Axelate from a model launcher into a
workstation platform.

### 3. Trust Surface

Local integrations are useful, but they are not automatically trusted.

Axelate should make boundaries visible:

- backend vs frontend
- local vs remote
- installed vs verified
- manual import vs official package
- allowed vs denied permissions
- user-owned secrets vs integration-owned state

The current repository does not yet ship full package signing, publisher
verification, package review, or managed execution. Those belong to later
platform layers.

## Immediate Focus

The next product work should prioritize:

1. runtime reliability
2. custom integration import and lifecycle
3. OpenAI-compatible local API
4. TypeScript and Python SDKs
5. integration templates and examples
6. visible trust and permission UX
7. MCP foundation after runtime and permissions are stable

Package discovery, account-backed ownership, and managed execution should not
lead the roadmap until the workstation and local integration path are reliable.

## Product Rules

- Do not make the chat tab the center of the brand.
- Do not force cloud accounts for local-only workflows.
- Do not imply that manually imported integrations are verified.
- Do not promise perfect DRM for local packages.
- Do not mix unsafe arbitrary execution with future curated package flows.
- Do not build package distribution before the workstation core is stable.

## Phase Direction

### Phase 1: Workstation Core

Ship a reliable Windows desktop with:

- stable provider routing
- stable streaming chat and image flows
- local runtime management
- integration import and lifecycle
- local API and SDK foundations
- health checks, logs, and repair tools

This phase proves product value to users and developers.

### Phase 2: Trusted Package Layer

Ship:

- package manifest and permission model
- verified package metadata
- signing and update trust
- reviewed package install/update/remove flow
- user-visible execution mode labels

This phase proves that Axelate can safely move beyond manual local imports.

### Phase 3: Platform Layer

Only after the workstation and package trust model are stable, add:

- package ownership sync
- curated package discovery
- publisher onboarding
- managed or hybrid execution contracts
- operational services around verified packages

This phase proves platform value beyond the desktop app.

## Reality Check

This product is real and implementable, but only under these conditions:

- workstation before marketplace
- local and BYOK before managed cloud complexity
- trust and permissions before growth
- integration runtime before public package distribution
- open core for desktop trust, controlled platform services later

If Axelate launches first as a reliable desktop AI workstation for running local
engines and user-installed integrations, the later platform layers become
believable.

## Final Product Statement

Axelate should become the trusted desktop AI workstation for running local
engines, BYOK cloud models, and user-installed AI integrations from one reliable
surface, with future verified packages and managed workflows added only after
the workstation core earns trust.
