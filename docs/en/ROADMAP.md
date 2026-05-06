# Axelate Roadmap

> Product execution roadmap as of 2026-05-06.
> Planning document only. It is not a setup guide and it does not mean every
> listed feature already exists in the repository today.

## Mission

Build Axelate into a trusted Windows-first AI workstation and local integration
runtime.

That means:

- reliable desktop core first
- local integrations second
- trusted package and managed execution layers later

Business and operations planning live outside this repository roadmap in the
private Axelate notes.

## Overall Difficulty

Overall product ambition: `8/10`.

Phase difficulty:

- workstation core: `6/10`
- local integrations and SDKs: `6/10`
- trusted package layer: `7/10`
- managed or hybrid execution layer: `9/10`

## Core Constraints

These constraints are not optional.

- Windows-first until the model is proven
- workstation before distribution
- local and BYOK before managed cloud complexity
- trust and permissions before growth
- clear product identity before feature expansion

## Market Read

The market does not need another generic AI chat client. Local AI users already
combine tools such as Ollama, LM Studio, Jan, AnythingLLM, Open WebUI, Pinokio,
ComfyUI, and Dify-like workflow builders. The repeated demand is for a reliable
control plane that makes those pieces usable without manual setup, broken
downloads, hidden GPU usage, unclear logs, unsafe scripts, or provider-specific
lock-in.

The strongest opening for Axelate is:

> A desktop AI launcher and runtime for integrations: one app that installs
> engines, manages local and BYOK cloud providers, owns secrets, exposes a
> stable local API, and lets user-added tools run against shared AI capability.

Axelate should not try to win by being the best chat UI. It should win by being
the dependable desktop layer underneath AI-powered tools.

## What Users Are Asking For

Signals from local AI communities and competing products point to these
priorities:

- simple install, update, resume, stop, and repair flows for local runtimes
- OpenAI-compatible local API support so existing clients can point at the app
- local-first privacy with optional cloud routing for frontier models
- hardware-aware model and engine selection across CUDA, Vulkan, ROCm, Metal,
  CPU, x64, arm64, and future cross-platform targets
- reliable idle behavior that does not leak memory or keep GPU/CPU busy after
  work completes
- logs, status, and diagnostics that explain failures without forcing users into
  terminals
- workflow tools, RAG, MCP, settings, and state management rather than only a
  prompt box
- one-click integration install from folders, archives, and trusted URLs, with
  clear permissions and uninstall behavior

These are product requirements, not nice-to-have polish. If they are weak,
users will fall back to the existing toolchain.

## Competitive Position

Axelate should learn from existing products without copying their identity:

- Ollama proves that a simple local model API can become ecosystem plumbing.
- LM Studio proves that a polished desktop model runner can reach non-expert
  users and still serve developers through APIs.
- Jan proves that local desktop AI, extensions, local API servers, and MCP can
  coexist in one open product.
- AnythingLLM proves demand for private workspaces, RAG, agents, and practical
  tools on top of local and cloud providers.
- Pinokio proves demand for one-click local AI app installation, but also shows
  why arbitrary script execution needs a stronger trust model.
- Dify-like products prove demand for workflow and agent builders, but Axelate
  should stay desktop/runtime-first before trying to become a full web platform.

The defensible position is not "Axelate replaces all of them." The defensible
position is "Axelate is the desktop runtime and integration layer that makes
AI-powered tools easier to install, run, observe, and trust."

## Stack Fit

The current stack fits this direction.

- Tauri 2 plus Rust is the right foundation for process lifecycle, downloads,
  archive extraction, local HTTP APIs, secure storage, hardware probing, logs,
  and cross-platform adapters.
- Tokio and reqwest fit long-running async work such as streaming, downloads,
  release fetching, and provider calls.
- Specta-generated TypeScript bindings reduce frontend/backend contract drift
  and should remain mandatory for Tauri commands.
- Vanilla TypeScript is acceptable for the current desktop UI, but the frontend
  needs strict component and controller discipline as settings, permissions,
  integrations, and package surfaces grow.
- The backend should remain the source of truth for secrets, runtime state,
  provider routing, module lifecycle, and persistent state.

The main stack risk is not the backend. The main risk is frontend and package
surface complexity growing faster than the product architecture. If the UI starts
carrying runtime truth or ad-hoc module behavior, the project will become hard to
stabilize.

## Ordered Execution Plan

This is ordered by the best mix of importance, simplicity, and dependency
sequence.

### 1. Fix Current-State Truth And Developer Docs

Difficulty: `1/10`

Work:

- keep `CURRENT_STATE.md`, `ROADMAP.md`, `TRUST_MODEL.md`, and
  `LAUNCHER_SDK.md` aligned with actual behavior
- remove stale claims when backend behavior changes
- document the exact local API, environment variables, runtime directories, and
  settings ownership rules
- keep examples runnable

Exit criteria:

- a developer can read the docs and build one integration without asking how
  tokens, settings, logs, and runtime folders work

### 2. Make Runtime Reliability Boring

Difficulty: `3/10` to `5/10`

Work:

- resumable downloads
- deterministic start, stop, cancel, and restart
- health checks and repair actions
- clear release selection for OS, architecture, accelerator, and archive type
- clear errors for missing engines, missing modules, bad archives, and GitHub
  release failures
- no memory or GPU growth while idle

Exit criteria:

- install, start, stop, restart, delete, and restart-after-app-relaunch work
  repeatedly without stale UI state or duplicate backend actions

### 3. Make Integrations First-Class Locally

Difficulty: `4/10` to `6/10`

Work:

- stable manifest validation
- folder, archive, and GitHub URL import
- predictable uninstall and external-folder-missing behavior
- clear runtime, cache, log, and settings ownership
- integration template generator
- minimal "hello Axelate" integration sample
- practical example integration such as Telegram or Discord summarizer/parser

Exit criteria:

- a user can add, configure, run, stop, remove, and re-add an integration without
  touching project internals

### 4. Add An OpenAI-Compatible Gateway

Difficulty: `5/10` to `7/10`

Work:

- `/v1/models`
- `/v1/chat/completions`
- `/v1/responses`
- `/v1/images/generations`
- streaming compatibility where practical
- compatibility tests against common OpenAI clients
- clear mapping from Axelate providers, engines, sessions, and settings to
  OpenAI-compatible request fields

Exit criteria:

- common OpenAI SDK clients can use Axelate for local and BYOK cloud routes
  without a custom adapter

### 5. Add SDKs For Real Integration Development

Difficulty: `5/10` to `7/10`

Work:

- TypeScript SDK
- Python SDK
- helpers for chat, image, settings, stage reporting, and module control
- typed errors
- examples that match the integration template
- version compatibility checks using `AXELATE_SDK_VERSION`

Exit criteria:

- integration authors can build useful tools without hand-writing local HTTP
  plumbing

### 6. Make Trust And Permissions Visible

Difficulty: `6/10` to `8/10`

Work:

- module permissions in the manifest
- local, managed, and hybrid mode labels
- install-time permission review
- verified/signed package state
- visible module token boundaries
- explicit MCP server and tool approvals
- clear warning for manually imported unverified integrations

Exit criteria:

- users can see what an integration is allowed to do before running it

### 7. Add MCP Foundation

Difficulty: `7/10` to `8/10`

Work:

- MCP server registry
- connection state
- tool discovery
- user approval for server and tool access
- failure handling and logs
- no hidden automatic unsafe execution

Exit criteria:

- MCP works as a controlled workstation feature, not as an invisible execution
  side channel

### 8. Prepare Package Signing And Update Trust

Difficulty: `7/10` to `9/10`

Work:

- signed package metadata
- verified publisher metadata
- update channels
- rollback metadata
- local verification before install/update
- clear official vs manual package state

Exit criteria:

- the desktop can distinguish trusted official packages from manual local
  imports

### 9. Add Trusted Package Discovery And Ownership

Difficulty: `8/10` to `9/10`

Work:

- reviewed package discovery surface
- ownership metadata
- ownership sync contract
- reviewed package install/update flow
- revocation and rollback behavior

Exit criteria:

- reviewed packages can be discovered, installed, updated, and revoked
  predictably.

### 10. Build Managed And Hybrid Runtime Support

Difficulty: `9/10` to `10/10`

Work:

- managed runtime API contract
- secure relay
- usage metering
- package ownership enforcement
- revocation
- managed logs and diagnostics
- deployment requirements

Exit criteria:

- protected workflows can run without shipping all sensitive logic locally, and
  users can understand what runs local vs remote

### Ordering Rule

Do not start a later layer if an earlier layer is still failing in normal use.
The product earns the right to add platform complexity only after the desktop
runtime and local integration path are reliable.

## Phase 0: Product Reset

### Goal

Remove identity confusion and define one honest product direction.

### Work

- consolidate documentation into English canonical docs
- define the product as a Windows AI workstation, not a generic chat client
- define future platform boundaries before adding new layers
- remove or demote legacy positioning that implies distribution features already
  exist

### Exit Criteria

- one clear product statement exists
- one current-state document exists
- one roadmap exists
- future work can be judged against the workstation thesis

### Status

In progress and partially completed.

## Phase 1: Workstation Core

### Goal

Turn the current shell into a reliable daily-use Windows AI workstation.

### Workstream A: Desktop Reliability

- stabilize startup, shutdown, and state restore
- make runtime status deterministic after restart
- make selection state and model settings persistent and obvious
- improve window, tray, and shell consistency

### Workstream B: AI Provider Layer

- keep OpenRouter path stable
- normalize provider/model capabilities cleanly
- make text and image routing explicit
- keep web access as an optional capability toggle
- keep custom model support first-class

### Workstream C: Chat and Session System

- keep streaming fast and predictable
- preserve chat history correctly
- keep summary compaction hidden and reliable
- make request isolation and cancellation robust
- improve file and multimodal handling only where it is already justified

### Workstream D: Local Runtime Orchestration

- make install and update flows trustworthy
- improve start, stop, health, and log visibility
- keep hardware-aware resolution readable and debuggable
- keep ComfyUI out of the core promise until it is truly product-ready

### Exit Criteria

- a new user can install the app and complete a first useful workflow
- local and cloud model routing feels coherent
- logs, monitoring, and repair tools explain failures
- provider settings are understandable
- local integrations can run through the launcher without manual path hacks

### Why This Phase Matters

If this phase fails, later package and platform layers should not launch.

## Phase 2: Integration And Package Foundation

### Goal

Create the technical base for user-installed integrations and future reviewed
packages.

### Work

- define package manifest format
- define package permission model
- define settings schema model for packages
- define install, update, rollback, and uninstall contracts
- define signing flow for official builds
- define ownership sync contract for future reviewed packages

### Packaging Modes

The package system must support three modes from the start:

- local
- managed
- hybrid

### Exit Criteria

- package manifests are versioned and validated
- package lifecycle is deterministic
- packages can be installed and removed safely
- package permissions are visible to the user
- the desktop understands package metadata without ad-hoc code paths

### Why This Phase Matters

Without a real package model, package discovery is just marketing.

## Phase 3: Trusted Discovery And Ownership

### Goal

Add a controlled discovery and ownership layer for reviewed packages. Business
and operations planning is intentionally kept outside this repository roadmap.

### Workstream A: Public Product Surface

- landing page
- download flow
- trust explanation
- package discovery
- account and ownership flow only when needed for verified packages

### Workstream B: Reviewed Package Intake

- package submission flow
- review rules
- screenshots and listing metadata
- quality and support metadata

### Workstream C: Desktop Integration

- ownership sync
- reviewed package browsing inside desktop
- install from owned or claimed packages
- update and rollback from official channel

### Trust Rules

- no public self-serve upload at first
- no claims of perfect IP protection for local packages
- no unsafe execution path hidden behind one click

### Exit Criteria

- users can install reviewed packages through a trusted flow
- packages can be submitted and updated through a review path
- ownership state syncs into the desktop reliably

### Difficulty

`8/10`

## Phase 4: Managed And Hybrid Runtime Support

### Goal

Support packages that need stronger protection and platform-hosted execution.

### Work

- define managed runtime API contract
- define secure relay and session authentication
- define usage metering
- define revocation and expiration
- define managed logs and diagnostics
- define deployment requirements
- optionally host official managed execution

### Operational Requirements

- incident handling
- security response
- cost controls
- rate limiting
- abuse prevention
- auditability

### Exit Criteria

- sensitive logic does not need to ship locally when not appropriate
- platform can meter usage without trust collapse
- users understand whether a package runs local, remote, or hybrid

### Difficulty

`9-10/10`

## Phase 5: Open Core And Platform Boundary

### Goal

Make the desktop core auditable and contribution-friendly while keeping future
platform services clearly separated.

### Work

- split open desktop core from platform services
- publish package spec and SDKs
- choose final open-core license
- formalize contribution rules
- document official build and signing policy

### Exit Criteria

- external contributors can work on the desktop core safely
- platform services stay operationally controlled
- forks do not confuse official trust guarantees

## What Is Explicitly Not A Priority

Not now:

- mobile apps
- cross-platform perfection
- social feeds
- open upload marketplace
- enterprise-first sales motion
- feature racing against every chat client
- turning Axelate into a generic unsafe script runner

## Go / No-Go Checkpoints

### Checkpoint 1: After Phase 1

Question:

- is the workstation core reliable enough that people would use it weekly without
  package discovery?

If no:

- stop expanding scope
- fix reliability, UX clarity, and trust

### Checkpoint 2: Before Phase 3

Question:

- do we have a safe package model, a review process, and ownership sync that is
  understandable to users?

If no:

- do not launch package discovery

### Checkpoint 3: Before Phase 4

Question:

- can we run managed infrastructure without collapsing trust or reliability?

If no:

- keep the product focused on local and hybrid packages first

## Success Metrics

### Workstation Metrics

- install to first successful workflow
- runtime install success rate
- runtime recovery success rate
- chat success rate
- crash-free sessions

### Package Metrics

- reviewed package install completion rate
- ownership sync reliability
- rollback success rate
- package update success rate

### Managed Runtime Metrics

- ownership verification reliability
- incident frequency
- abuse rate
- package uptime and latency

## Final Roadmap Rule

Axelate should only earn the right to become a package platform after it becomes
a trusted workstation.

That sequencing is the roadmap.
