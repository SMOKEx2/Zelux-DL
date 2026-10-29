//! Prism application core.
//!
//! Everything the app does that is not UI: persistence, the download manager,
//! queues and scheduling, categories, browser IPC, the site grabber, clipboard
//! monitoring, antivirus scanning and OS integration. The Tauri shell is a thin
//! layer over this crate, which keeps all business logic testable headlessly.

pub mod antivirus;
pub mod categories;
pub mod clipboard;
pub mod db;
pub mod events;
pub mod grabber;
pub mod huggingface;
pub mod ipc;
pub mod manager;
pub mod model;
pub mod paths;
pub mod platform;
pub mod resolver;
mod rt;
pub mod scheduler;
pub mod settings;

/// User agent used when neither the browser nor the user supplied one.
pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
