/// Module controller service
pub mod controller;
/// Module downloader service
pub mod downloader;
mod downloader_comfyui;
mod downloader_install;
mod downloader_progress;
mod downloader_service;
mod downloader_support;
mod downloader_transfer;
mod github_release_selection;
/// Open-Source engine GitHub releases parsing
pub mod github_releases;
/// Filesystem watcher for externally changed integrations.
pub mod integration_watcher;
/// Module lifecycle management
pub mod lifecycle;
/// Module-scoped filesystem paths
pub mod paths;
/// Custom module settings UI path resolution
pub mod settings_ui;
/// Custom module settings UI protocol host
pub mod settings_ui_protocol;
