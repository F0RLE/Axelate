# Axelate Vision

> Strategic direction as of 2026-04-23.
> Planning document only. Use `CURRENT_STATE.md`, `GETTING_STARTED.md`, and `DEVELOPMENT_WORKFLOW.md` for the repository as it works today.

## Product Name

- Short name: Axelate
- Working full name: Axelate Workstation Platform
- Category: Windows-first AI workstation and creator marketplace
- Product sentence: Axelate is a secure desktop control plane for local AI runtimes, BYOK cloud models, MCP tools, and packaged creator apps.

## Why This Product Should Exist

The AI desktop market is crowded with chat clients, local model launchers, agent shells, and web dashboards. What is still weak on Windows is the layer that combines all of the following in one consistent product:

- local runtime install, update, start, stop, and health status
- cloud model access through user-owned keys
- MCP tool access with explicit permissions
- creator-distributed AI packages with billing and updates
- backend-owned secrets, signing, entitlements, and managed execution when local delivery is not enough

Axelate should exist to be that layer.

The product should not compete as "another chat UI". It should compete as the trusted operating surface for practical AI work on Windows.

## Product Thesis

Axelate wins only if it stays narrow and honest:

- one desktop shell for local and cloud AI work
- one package system for creator tools and paid workflows
- one trust model for permissions, secrets, updates, and entitlements

Axelate loses if it tries to become:

- a generic social marketplace
- a pure web dashboard clone
- a random unsafe script runner
- a giant everything-app before the workstation core is reliable

## Target Users

- Power users who switch between local runtimes and cloud models.
- Creators who want to sell AI-powered tools without building their own launcher, updater, billing system, and entitlement service.
- Small studios that need one desktop surface for text, image, automation, and tool-backed AI workflows.

## Core Product Definition

### 1. Desktop App

The desktop app is the main product.

It should provide:

- local engine lifecycle management
- cloud provider selection and model routing
- MCP server configuration and permission prompts
- package install, update, rollback, and uninstall
- backend-owned credential storage
- logs, health checks, and repair actions

The desktop app should stay Windows-first until the model is proven.

### 2. Website

The website is not optional. It is the public business surface.

It should handle:

- landing pages and positioning
- download distribution
- pricing
- account creation
- billing and subscriptions
- package discovery
- creator onboarding
- creator payouts
- docs, legal pages, and trust material

Recommended first public structure:

- `/` product landing page
- `/download` installer distribution
- `/pricing` plans and marketplace fees
- `/marketplace` searchable package catalog
- `/creators` creator program and publishing rules
- `/account` purchases, entitlements, devices, billing
- `/trust` security model, signing, package review
- `/docs` later, once the public protocol and package spec stabilize

### 3. Creator Platform

Creators should be able to ship AI products in three package modes:

- `Local package`
  - shipped to the user machine
  - best for tools that can run locally with acceptable IP exposure
  - supports versioning, signing, updates, rollback, and local settings schemas
- `Managed package`
  - sensitive logic stays on creator or platform infrastructure
  - desktop acts as authenticated client and orchestrator
  - best for protected commercial workflows and premium automations
- `Hybrid package`
  - local UI and setup, remote execution for sensitive steps
  - best for mixed local/cloud tools

This packaging model is the bridge between the desktop shell and the business.

## Business Logic

### User Flow

1. User installs Axelate desktop.
2. User signs in or continues in local-only mode.
3. User adds cloud provider keys or installs local runtimes.
4. User browses packages on the website or inside the desktop marketplace.
5. User purchases or claims a package entitlement.
6. Desktop syncs entitlements and installs the package.
7. Package runs in local, managed, or hybrid mode.
8. Updates, permissions, logs, and billing stay visible in one place.

### Creator Flow

1. Creator applies for creator access.
2. Creator creates a package listing with category, screenshots, pricing, support terms, and manifest.
3. Creator chooses `local`, `managed`, or `hybrid`.
4. Creator uploads signed assets or registers the managed runtime endpoint.
5. Platform runs validation, malware checks, schema checks, and policy review.
6. Approved package becomes visible in the marketplace.
7. Purchases create entitlements and payout records.
8. Updates go through version review and staged rollout.

### Platform Flow

The platform owned by Axelate should be responsible for:

- account and identity
- package signing and trust chain
- entitlement issuance
- billing and payouts
- abuse prevention
- marketplace discovery and ranking
- package review
- optional managed runtime orchestration

The platform should not promise impossible guarantees.

Local packages are convenient and monetizable, but they are not undecompilable.
Managed packages are the correct answer for creators who need stronger protection.

## Revenue Model

### Owner Revenue

Axelate should have three revenue lines.

#### 1. Marketplace fee

- recommended default: `15%` platform fee on creator software revenue
- payout target: creator receives `85%` before payment processor and tax adjustments

This is simple, legible, and competitive enough for an early curated marketplace.

#### 2. Pro subscription for end users

The desktop should remain useful for free local and BYOK usage.

Paid `Axelate Pro` should unlock platform features, not basic trust:

- encrypted cloud backup of settings and entitlements
- multi-device sync
- advanced package rollback history
- premium diagnostics and recovery tools
- early access to verified package releases

This should be a modest subscription, not the core profit engine.

#### 3. Managed runtime margin

For managed packages, Axelate can charge for platform-hosted orchestration:

- entitlement checks
- secure relay
- execution control
- usage metering
- storage and logs

This can be billed as:

- pass-through infra cost plus a platform margin
- or a fixed platform fee charged to creators

The product should start with pass-through plus margin. It is easier to explain and less risky.

### Creator Revenue

Creators should be able to earn through:

- one-time purchases
- subscriptions
- paid upgrades
- seat-based licenses later
- managed workflow subscriptions

Creators should control their own list prices.
The platform should only control fee policy, refund windows, and content rules.

## Open vs Closed Strategy

The best long-term model is `open core + closed commercial platform`.

### What Should Be Open

- desktop core
- package manifest specification
- public SDKs
- MCP and provider adapters that are part of the core client
- documentation for package and entitlement integration

Selected license for the open core: `Apache-2.0`.

Reason:

- trust matters for a BYOK desktop product
- contributors are more likely to help if the core is auditable
- forks do not destroy the business if the marketplace, signing, billing, and brand stay controlled

### What Should Stay Closed

- official marketplace backend
- billing and payout services
- entitlement service
- signing infrastructure
- abuse detection
- managed runtime orchestration
- official ranking and recommendation logic

### Can Everyone Modify It

For the open core:

- yes, anyone can read, fork, modify, and submit changes
- no, modified forks do not automatically become official builds

For the official platform:

- no, only the owner and approved maintainers can change the production marketplace and commercial backend

For creator packages:

- creators may choose open packages
- creators may choose closed local packages
- creators may choose managed packages where sensitive logic never ships

This is the practical trust and business split.

## Product Rules

- Do not promise perfect DRM for local packages.
- Do not make the chat tab the center of the brand.
- Do not force cloud accounts for local-only usage.
- Do not mix unsafe arbitrary execution with the curated marketplace path.
- Do not build a creator marketplace before the workstation core is stable.

## What Axelate Should Actually Build

### Phase 1: Workstation Core

Ship a reliable Windows desktop with:

- strong provider routing
- strong streaming chat and image flows
- local runtime management
- MCP client support
- package manifest and install model
- health checks, logs, and repair tools

This phase proves product value to users.

### Phase 2: Curated Creator Marketplace

Ship:

- website
- creator onboarding
- package listing flow
- package signing and review
- entitlement sync into desktop

This phase proves creator demand.

### Phase 3: Managed Package Layer

Ship:

- managed package runtime contract
- billing for managed subscriptions
- creator payout automation
- usage metering
- optional owner-hosted execution plane

This phase proves defensible business value.

## Reality Check

This product is real and implementable, but only under these conditions:

- Windows-first, not cross-platform from day one
- curated marketplace, not open upload chaos
- open core for trust, closed platform for monetization
- local plus BYOK first, managed cloud second
- creator distribution and entitlement first, full enterprise later

If Axelate tries to launch as:

- chat app
- launcher
- package manager
- agent platform
- public marketplace
- managed cloud

all at once, it will become diffuse and weak.

If Axelate launches first as:

- the trusted Windows AI workstation for running local and paid AI tools

then the marketplace and managed layer become believable.

## Execution Difficulty

This product is feasible, but it is not cheap or simple to execute well.

Overall ambition difficulty: `9/10`.

Phase difficulty:

- workstation core only: `6/10`
- package system and curated marketplace: `8/10`
- managed runtime, billing, payouts, signing, and abuse control: `9-10/10`

Why the score is high:

- the desktop product alone requires stable runtime orchestration, provider routing, permissions, logs, recovery, and packaging
- the marketplace requires trust, policy review, entitlement sync, billing, and payouts
- the managed layer requires production backend operations, metering, security, incident handling, and revocation

The product becomes realistic only if it is built in phases and only if each phase proves value before the next one starts.

## Final Product Statement

Axelate should become the Windows-first AI workstation and creator distribution platform: a desktop product where users run local engines, connect cloud models, install verified MCP-enabled packages, and buy creator-built AI tools from one trusted surface; with an open desktop core for trust and a closed commercial platform for billing, signing, entitlements, payouts, and managed execution.
