# Axelate Roadmap

> Strategic execution roadmap as of 2026-04-23.
> Planning document only. It is not a setup guide and it does not mean every listed feature already exists in the repository today.

## Mission

Build Axelate into the trusted Windows-first AI workstation and creator distribution platform.

That means:

- reliable desktop core first
- curated distribution second
- managed execution third

## Overall Difficulty

Overall product ambition: `9/10`.

Phase difficulty:

- workstation core: `6/10`
- package system and curated marketplace: `8/10`
- managed runtime and platform operations: `9-10/10`

## Core Constraints

These constraints are not optional.

- Windows-first until the model is proven
- workstation before marketplace
- curated packages before public upload chaos
- local and BYOK before managed cloud complexity
- trust and permissions before growth hacks
- clear product identity before feature expansion

## Phase 0: Product Reset

### Goal

Remove identity confusion and define one honest product direction.

### Work

- consolidate documentation into English canonical docs
- define the product as a Windows AI workstation, not a generic chat client
- define future business logic before adding new platform layers
- remove or demote legacy positioning that implies a marketplace already exists

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

### Workstream E: MCP Foundation

- add real MCP client support behind clean adapters
- make permissions explicit per server and per tool
- expose connection state in the desktop UI
- avoid hidden or automatic unsafe execution

### Exit Criteria

- a new user can install the app and complete a first useful workflow
- local and cloud model routing feels coherent
- logs, monitoring, and repair tools explain failures
- provider settings are understandable
- MCP works as a feature, not as a science experiment

### Why This Phase Matters

If this phase fails, the marketplace should not launch.

## Phase 2: Package System Foundation

### Goal

Create the technical base for creator-distributed packages without pretending the marketplace is already live.

### Work

- define package manifest format
- define package permission model
- define settings schema model for packages
- define install, update, rollback, and uninstall contracts
- define signing flow for official builds
- define entitlement sync contract for future commercial packages

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

Without a real package model, a marketplace is just marketing.

## Phase 3: Curated Marketplace MVP

### Goal

Launch a controlled creator marketplace with real purchases and real entitlements, but only for reviewed packages.

### Workstream A: Website and Commerce

- landing page
- download flow
- pricing
- account creation
- billing
- purchase history
- entitlement management

### Workstream B: Creator Program

- creator onboarding
- package submission flow
- review rules
- screenshots and listing metadata
- pricing controls
- support and refund policy

### Workstream C: Desktop Integration

- account sign-in
- entitlement sync
- marketplace browsing inside desktop
- install from owned entitlements
- update and rollback from official channel

### Trust Rules

- no public self-serve upload at first
- no anonymous package publishing
- no claims of perfect IP protection for local packages
- no unsafe execution path hidden behind one click

### Exit Criteria

- users can buy and install reviewed packages
- creators can submit and update packages
- entitlements sync into the desktop reliably
- refund and payout operations are operationally manageable

### Difficulty

`8/10`

## Phase 4: Managed and Hybrid Runtime Platform

### Goal

Support creators who need stronger protection and platform-hosted execution.

### Work

- define managed runtime API contract
- define secure relay and session authentication
- define usage metering
- define revocation and expiration
- define managed logs and diagnostics
- define creator-side deployment requirements
- optionally host official managed execution for creators

### Operational Requirements

- incident handling
- security response
- cost controls
- rate limiting
- abuse prevention
- auditability

### Exit Criteria

- managed packages can be sold and enforced
- creator logic does not need to ship locally when not appropriate
- platform can meter and bill usage without trust collapse
- users understand whether a package runs local, remote, or hybrid

### Difficulty

`9-10/10`

## Phase 5: Open Core Transition

### Goal

Make the desktop core auditable and contribution-friendly while keeping the commercial platform defensible.

### Work

- split open desktop core from closed platform services
- publish package spec and SDKs
- choose final open-core license
- formalize contribution rules
- document official build and signing policy

### Exit Criteria

- external contributors can work on the desktop core safely
- official commercial backend stays private and operationally controlled
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

- is the workstation core reliable enough that people would use it weekly without the marketplace?

If no:

- stop expanding scope
- fix reliability, UX clarity, and trust

### Checkpoint 2: Before Phase 3

Question:

- do we have a safe package model, a review process, and entitlement sync that is understandable to users?

If no:

- do not launch a marketplace

### Checkpoint 3: Before Phase 4

Question:

- can we run commercial managed infrastructure without burning margin or collapsing trust?

If no:

- keep the business focused on local and hybrid packages first

## Success Metrics

### Workstation Metrics

- install to first successful workflow
- runtime install success rate
- runtime recovery success rate
- chat success rate
- crash-free sessions

### Marketplace Metrics

- package conversion rate
- paid package install completion rate
- creator retention
- refund rate
- payout accuracy

### Managed Platform Metrics

- gross margin after infra cost
- entitlement verification reliability
- incident frequency
- abuse rate
- package uptime and latency

## Final Roadmap Rule

Axelate should only earn the right to become a marketplace after it becomes a trusted workstation.

That sequencing is the roadmap.
