# Axelate Trust Model

> Practical trust model for the current workstation core and the next permission layers.
> The current-state sections are repository-grounded; the future-state sections are design targets, not shipped guarantees.

## Core Position

Axelate wants to become a trusted desktop control plane.

That only works if the launcher is explicit about:

- what lives in the backend
- what the frontend is allowed to do
- what local modules are allowed to do
- what agents are allowed to do through launcher APIs
- what future MCP and package permissions should look like

## What Is Protected Today

Current repository-grounded trust decisions:

- sensitive values are backend-owned
- Rust owns domain logic and persisted state
- frontend bindings are generated from Rust types
- process and module lifecycle are controlled from the backend side
- secure storage infrastructure exists for provider secrets
- local integration API tokens are issued at runtime and scoped to the launcher
  process or a specific module
- module-owned local API routes reject access to other module ids
- module ids, runtime entry paths, settings UI paths, archive entries, and log
  target identifiers are validated before sensitive filesystem operations
- frontend external URL opening is restricted to expected public protocols

This means the UI is not the source of truth for secrets or runtime control.

## Implemented Trust Controls Today

These controls exist in the current codebase and should stay protected by tests:

- backend-owned provider secret storage
- generated Rust-to-TypeScript command bindings
- scoped bearer tokens for launcher-managed integrations
- loopback-only local integration API
- per-module runtime and log directory ownership
- archive extraction checks for traversal, unsupported entry types, duplicate
  entries, file count limits, single-file size limits, and total-size limits
- explicit validation before opening console log target folders
- external URL protocol allowlisting before frontend shell-open calls
- local integration API routes that keep module-owned operations scoped to the
  owning module

These controls reduce accidental trust escalation. They do not make imported
integrations sandboxed or verified packages.

## Current Security Boundaries

### Backend

The Rust backend currently owns:

- secret storage
- persisted chat state
- runtime and module lifecycle
- download and extraction flows
- process inspection and cleanup
- generated frontend contracts

### Frontend

The TypeScript frontend currently owns:

- shell composition
- UI rendering
- user interaction flow
- presentation of settings, logs, downloads, and monitoring

The frontend should remain a thin orchestration and UX layer.

### Modules And Local Runtimes

Local runtimes and modules are useful, but they are not automatically trusted.

Current practical rule:

- local modules are product capabilities, not arbitrary unrestricted execution promises
- manually imported integrations are local code selected by the user
- launcher-managed script runtimes receive scoped environment variables, runtime
  directories, log directories, and local API tokens
- future reviewed packages must not reuse the same trust language as manual
  imports

Future package and module UX should make this much more visible.

### Agents And Automation

Agents should use documented launcher APIs, not the UI DOM and not private files.

Agent Control is local-only and token-based. Users create Trusted Local or Full
Access profiles in Settings. The full token is shown once, stored by the local
tool, and can be rotated, revoked, or deleted by the user.

The normal agent scopes are:

- `observe`: launcher health, installed module list, module status, provider and
  model inventory, pending approvals, and recent sanitized console logs
- `operate`: open launcher pages, select module cards, start, stop, restart,
  repair, and run AI requests
- `configure`: read and update non-secret module settings
- `draft-create`: create integration draft folders without installing or running
  them
- `full-access`: explicit user-granted local override

Mutating actions need a stronger scope and should be logged:

- start, stop, or restart an integration
- update integration settings
- request a repair action
- create an integration draft

Some actions should require user approval even after an agent is connected:

- install, delete, or update packages
- change provider secrets
- expose raw logs that may contain sensitive data
- grant broader filesystem or network permissions

This keeps agents useful without turning them into a hidden admin surface.

The detailed API contract lives in [Agent Control](AGENT_CONTROL.md).

## What Users Should Be Able To Trust

Current repository direction already supports these expectations:

- provider secrets are not frontend-owned
- runtime start and stop actions are backend-mediated
- logs and repair tools should explain what happened when something fails

The launcher should eventually make the remaining guarantees obvious:

- package and module permissions are visible before install or execution
- local, remote, and hybrid execution modes are clearly labeled

## Not Shipped Yet

The repository is not done with these trust surfaces yet. Treat them as the intended next layer, not as promises that the desktop fully enforces today.

## What Still Needs To Be Made Explicit

The current codebase is stronger than the current public trust explanation.

What still needs clearer product-level documentation and UX:

- secret storage model
- package permission model
- module capability boundaries
- agent scopes and approval rules
- MCP server and tool permission prompts
- package verification and signing flow
- difference between local, managed, and hybrid execution

## Future Permission Model

The launcher should move toward explicit permission surfaces for:

- file system access
- network access
- local process execution
- model/provider usage
- launcher control actions
- MCP server connection
- MCP tool invocation
- package install and update trust

The important rule is simple:

- no silent trust escalation

## MCP Direction

MCP support should be opt-in and permissioned.

Axelate should expose its own MCP server only as an adapter over the documented
Agent Control API. The MCP server should not get private shortcuts around
authorization, audit logs, or approval prompts.

Good future behavior:

- users see which server is connected
- users see which tools a server exposes
- users approve access intentionally
- failures degrade safely
- unsafe execution is never hidden behind vague wording

## Package Direction

Future creator packages should not be presented as magic trusted blobs.

The launcher should eventually show:

- who published the package
- what mode it runs in: local, managed, or hybrid
- what permissions it needs
- whether it is signed or verified
- how updates and rollback work

## Final Rule

Axelate does not earn trust by saying it is secure.

It earns trust by making boundaries visible:

- backend vs frontend
- trusted vs untrusted
- local vs remote
- installed vs verified
- allowed vs denied
