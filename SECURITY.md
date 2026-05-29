# Security Policy

## Supported Versions

Axelate is in active early development. Security fixes are made on `nightly` first and released through `main` when a tagged release is prepared.

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub private vulnerability reporting when available, or contact the repository owner through GitHub with enough detail to reproduce and assess the issue.

Include:

- affected version or commit
- operating system version
- reproduction steps
- expected impact
- relevant logs, screenshots, or proof-of-concept details

## Security Defaults

The repository uses GitHub secret scanning, push protection, Dependabot alerts, and Dependabot security updates.

Additional repository security automation:

- CodeQL scans TypeScript/JavaScript and Rust on protected branch pushes, weekly schedule, and manual dispatch.
- Dependency Review runs on pull requests targeting `main` and `nightly` when npm or Cargo dependency files change.
- Scheduled Security Audit runs `npm audit --audit-level=high` and `cargo audit`.
- CodeRabbit is configured to review security-sensitive Rust/Tauri, TypeScript, workflow, and resource changes.

Release tags must match project versions and point to commits reachable from `main`. Tags matching `v*` are protected against deletion and non-fast-forward updates.

Current application security posture:

- provider secrets are backend-owned
- provider secrets are stored in an encrypted backend file today; platform
  keystore storage is planned but not implemented yet
- frontend/backend contracts are generated from Rust types
- local integration API tokens are runtime-issued and scoped
- import paths, runtime entry paths, settings UI paths, archive entries, and log
  target identifiers are validated before sensitive filesystem operations
- frontend external shell-open URLs are restricted to expected public protocols

These controls are defense-in-depth for the current workstation core. Manually
imported integrations are still local code selected by the user, not reviewed or
signed packages.
