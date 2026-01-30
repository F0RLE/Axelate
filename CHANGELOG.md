# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive frontend test suite (AIBridge, StateService, TauriProvider, ModuleService, NavigationService)
- Security audit steps in CI (npm audit, cargo audit)
- CODING_STANDARDS.md Section 61: Security Deep Dive (HBE, Memory Hygiene, IPC Security)

### Changed
- Updated CODING_STANDARDS.md to version 2.6.0
- Moved Appendix A-C to end of document
- Updated CI workflow with security audit integration

### Fixed
- Resolved lint errors in test files
- Fixed document structure issues in CODING_STANDARDS.md

---

## [0.1.0] - 2026-01-30

### Added
- **Core Application**
  - Tauri v2 desktop application with Rust backend
  - TypeScript frontend with vanilla DOM manipulation
  - Service-oriented architecture (Core, StateService, TauriProvider, etc.)

- **AI Integration**
  - AIBridge for multiple AI provider support (Gemini, GPT, Claude)
  - Streaming response handling
  - Secure API key storage with Hardware-Bound Encryption (HBE)

- **Module System**
  - Dynamic module download and installation
  - Module lifecycle management (start, stop, restart)
  - Progress tracking with event-driven updates

- **State Management**
  - Hybrid state persistence (Backend + LocalStorage fallback)
  - UI state synchronization across sessions
  - Debounced auto-save functionality

- **Internationalization**
  - Multi-language support (English, Russian, Chinese)
  - Dynamic translation loading
  - RTL layout support

- **Security**
  - Hardware-Bound Encryption for sensitive data
  - Tauri v2 capabilities permission system
  - Secure IPC communication

- **Developer Experience**
  - ESLint + Prettier configuration
  - Vitest test framework setup
  - CI/CD with GitHub Actions

### Backend (Rust)
- Tauri commands for IPC
- System monitoring (CPU, RAM, GPU, Disk)
- Module controller pattern
- Secure storage with AES-256-GCM encryption
- Path management utilities

### Frontend (TypeScript)
- Core orchestrator pattern
- Service/UI split architecture
- Template loading system
- Global bridge for cross-module communication
- Navigation history stack

### Documentation
- CODING_STANDARDS.md (60+ sections)
- Architecture documentation
- API reference
- Getting started guide

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.0 | 2026-01-30 | Initial release with core functionality |

---

## Legend

- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security-related changes
