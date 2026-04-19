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
/// Module lifecycle management
pub mod lifecycle;
