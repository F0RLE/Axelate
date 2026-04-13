# Security Hardening

This document describes the protections that are realistic for Axelate today.

## Important reality check

Desktop applications cannot be made undecompilable.
Tauri, Rust, and minified frontend bundles can raise the cost of reverse engineering, but they cannot prevent it.

The goal is:

- reduce exposed attack surface
- protect secrets at rest
- make tampering and supply-chain mistakes more visible
- make reverse engineering more expensive

## Protections already present

### Runtime boundary protection

- Tauri capabilities are enabled and scoped through `src-tauri/capabilities/default.json`
- CSP is enabled in `src-tauri/tauri.conf.json`
- `withGlobalTauri` is disabled
- frontend HTML rendering uses DOMPurify

### Secret protection

- secure values are stored in `secure.enc`
- the store is encrypted with AES-GCM
- the encryption key is derived from machine identity plus an app pepper

This protects local secrets against casual file inspection.
It does not protect against a fully compromised host or a determined local attacker with code execution.

### Release binary hardening

Rust release profile already uses:

- `strip = true`
- `lto = true`
- `codegen-units = 1`
- `panic = "abort"`

Frontend release build already uses:

- minification
- no release sourcemaps
- dropped `console` and `debugger`

The frontend build now also enables stronger top-level name mangling and strips output comments.

### Release integrity

The release workflow generates `SHA256SUMS.txt` next to bundled installers.
This gives the team a simple integrity artifact for release verification and distribution.

## What still matters most

### 1. Code signing

For Windows, code signing is the biggest missing release protection.

Without code signing:

- users get weaker publisher trust
- SmartScreen reputation is worse
- tampering is harder to detect

Recommended next step:

- obtain an Authenticode code-signing certificate
- sign the final `.exe` and installer artifacts in CI
- use a timestamp server during signing

### 2. CI security gates

Current release gates:

- block the release workflow on `npm audit --audit-level=high`
- block the release workflow on `cargo audit`
- generate and verify `SHA256SUMS.txt`
- fail if release output accidentally contains sourcemaps
- optionally fail on unsigned `.exe` and `.msi` when `AXELATE_REQUIRE_SIGNING=1`

Recommended next release gates:

- pin action versions in GitHub Actions
- enable CI signing and then set `AXELATE_REQUIRE_SIGNING=1`

### 3. Secret minimization

Never ship long-lived secrets inside the frontend bundle or Tauri config.
Treat the frontend as inspectable by a determined user.

### 4. Reverse-engineering expectations

Reasonable hardening:

- stripped Rust release binaries
- minified frontend bundle
- no production sourcemaps
- no debug logging in release

Unreasonable expectation:

- “full protection from decompilation”

If the business model depends on code secrecy alone, local desktop distribution is the wrong trust model.

## Team checklist

For development:

- install Windows SDK
- install Microsoft C++ Build Tools
- install WebView2 Runtime
- use portable or system Node/Rust

For release:

- run `npm run verify`
- run `npm run release`
- verify `SHA256SUMS.txt`
- run `.github/scripts/verify-all.ps1 -IncludeReleaseSecurity` only when using the legacy manual PowerShell path
- sign artifacts if a certificate is available

## Related files

- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/infrastructure/crypto/secure_storage.rs`
- `.github/scripts/release.ps1`
