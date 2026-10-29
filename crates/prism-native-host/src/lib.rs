//! Prism native messaging host.
//!
//! This crate is both:
//!
//! * the `prism-native-host` binary that browsers start (via native messaging)
//!   and that relays every extension message to the running Prism app over
//!   loopback HTTP (`POST http://127.0.0.1:<port>/v1/message`, bearer token), and
//! * a small library the app core reuses for its one-click "repair browser
//!   integration" page: [`registration`] (write/remove/inspect the native
//!   messaging host manifests + Windows registry keys) and [`paths`] (the
//!   app-data-dir / `ipc.json` location contract).
//!
//! The app core should depend on it with `default-features = false` (no HTTP
//! client is pulled in then).

pub mod args;
pub mod framing;
pub mod logger;
pub mod paths;
pub mod protocol;
pub mod registration;

#[cfg(feature = "host")]
pub mod host;
#[cfg(feature = "host")]
pub mod ipc;

/// Native messaging host name (the manifest `name` and registry key name).
pub const HOST_NAME: &str = "dev.zeluxdl.host";

/// Human readable description written into the host manifest.
pub const HOST_DESCRIPTION: &str = "ZeluxDL download manager browser integration";

/// Stable ID of the unpacked/dev Chromium extension. It is derived from the
/// public key embedded in `extension/manifest` (`key`), see `extension/README.md`.
pub const CHROME_EXTENSION_ID: &str = "knbafelhijahhnpjkfjggcljdalpbaac";

/// Gecko ID of the Firefox build (`browser_specific_settings.gecko.id`), the one listed on
/// Firefox Add-ons (`prism@prism.dev` was already taken there).
pub const FIREFOX_EXTENSION_ID: &str = "extension@zeluxdl.local";

/// Earlier Firefox IDs that may still connect: copies loaded by hand before Prism 1.1.6.
pub const LEGACY_FIREFOX_EXTENSION_IDS: &[&str] = &[];

/// Every Firefox extension ID the host manifest allows (the current one first).
pub fn firefox_extension_ids() -> Vec<String> {
    std::iter::once(FIREFOX_EXTENSION_ID)
        .chain(LEGACY_FIREFOX_EXTENSION_IDS.iter().copied())
        .map(String::from)
        .collect()
}

/// Version of this host (same as the workspace version).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// File name of the host executable for the current platform.
#[cfg(windows)]
pub const HOST_BINARY_NAME: &str = "zeluxdl-native-host.exe";
/// File name of the host executable for the current platform.
#[cfg(not(windows))]
pub const HOST_BINARY_NAME: &str = "zeluxdl-native-host";

/// File name of the app executable the host launches (it lives next to the host).
#[cfg(windows)]
pub const APP_BINARY_NAME: &str = "ZeluxDL.exe";
/// File name of the app executable the host launches (it lives next to the host).
#[cfg(not(windows))]
pub const APP_BINARY_NAME: &str = "ZeluxDL";
