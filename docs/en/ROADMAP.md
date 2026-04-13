# Roadmap

This roadmap is intentionally short and grounded in the current repository.

## Current product

Axelate is currently:

- a desktop launcher for local AI engines
- an API-backed AI chat shell
- a unified UI for settings, downloads, monitoring, and debugging

Current confirmed capabilities:

- OpenRouter chat flow
- local module install and launch
- hardware-aware release selection
- secure backend-side key storage
- downloads and module lifecycle management

## Near-term direction

### 1. Solidify current launcher

- keep local engine flows stable
- keep API chat reliable
- improve install/start/stop visibility
- continue hardening release and security checks

### 2. Marketplace foundation

- turn the existing marketplace shell into a real product surface
- define package metadata and signing format
- define install, update, and rollback flows
- define purchase, entitlement, and download flows

### 3. Public scripts and apps

Target capability:

- users discover packages in the launcher
- users buy or obtain entitlement
- users run packages locally or through a managed remote layer
- package setup stays simple from the launcher UI

## Planned execution modes

### Basic / Local mode

For low-cost and convenience-driven packages:

- package is delivered to the user machine
- execution is local
- launcher provides install, config, launch, and update UX
- protection is best-effort only

Expected controls:

- signed package manifests
- checksum verification
- local policy checks
- device-aware licensing where useful

This mode is not expected to be unbreakable.

### Protected / Managed mode

For high-value or commercially sensitive packages:

- sensitive logic stays on the server
- launcher becomes the authenticated client and orchestrator
- backend enforces subscription, expiry, and access policy
- secrets and premium logic do not ship to the user machine

Expected controls:

- short-lived access tokens
- signed job manifests
- entitlement verification
- optional device binding
- stronger audit and revocation options

## Product rule

Do not promise “undecompilable” local packages.

The product model should stay honest:

- local mode = convenience + basic protection
- managed mode = stronger protection + higher operating cost
