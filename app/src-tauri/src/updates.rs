//! In-app updates: GitHub's `latest.json` → download the signed package → checkpoint every
//! download → install → restart into the new version.

use std::sync::atomic::Ordering;

use prism_core::manager::Core;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::commands::CmdResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    /// `false` where the app can't replace itself (deb/rpm, portable): offer the website instead.
    pub can_install: bool,
}

/// Only installs the updater can replace in place: the per-user setup (NSIS), the macOS app
/// and the AppImage. MSI (per-machine) would get a second, per-user copy, deb/rpm belong to the
/// package manager and the portable zip must stay portable — those get the website instead.
fn can_self_update() -> bool {
    use tauri::utils::config::BundleType;
    let portable = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join("portable.txt").exists()))
        .unwrap_or(false);
    if portable {
        return false;
    }
    match tauri::utils::platform::bundle_type() {
        Some(BundleType::Nsis | BundleType::App) => true,
        Some(BundleType::AppImage) => std::env::var_os("APPIMAGE").is_some(),
        _ => false,
    }
}

fn is_newer_version(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split('-')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|n| n.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let x = parse(a);
    let y = parse(b);
    let len = x.len().max(y.len());
    for i in 0..len {
        let xi = x.get(i).copied().unwrap_or(0);
        let yi = y.get(i).copied().unwrap_or(0);
        if xi != yi {
            return xi > yi;
        }
    }
    false
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> CmdResult<Option<UpdateInfo>> {
    let current = app.package_info().version.to_string();

    // 1. Try Tauri's built-in updater (if configured and valid release JSON exists)
    if let Ok(updater) = app.updater()
        && let Ok(Some(update)) = updater.check().await
    {
        return Ok(Some(UpdateInfo {
            version: update.version.clone(),
            current: update.current_version.clone(),
            notes: update.body.clone(),
            can_install: can_self_update(),
        }));
    }

    // 2. Direct GitHub Release API check (reliable fallback without needing custom signed latest.json)
    if let Ok(client) = reqwest::Client::builder().user_agent("ZeluxDL").build()
        && let Ok(resp) = client
            .get("https://api.github.com/repos/SMOKEx2/Zelux-DL/releases/latest")
            .send()
            .await
        && resp.status().is_success()
        && let Ok(json) = resp.json::<serde_json::Value>().await
        && let Some(tag) = json.get("tag_name").and_then(|v| v.as_str())
    {
        let remote_ver = tag.trim_start_matches('v');
        if is_newer_version(remote_ver, &current) {
            return Ok(Some(UpdateInfo {
                version: remote_ver.to_string(),
                current,
                notes: json
                    .get("body")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                can_install: false,
            }));
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> CmdResult<()> {
    if !can_self_update() {
        return Err("This installation is updated by your package manager or by hand.".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("ZeluxDL is up to date.")?;
    tracing::info!("downloading update {}", update.version);
    let mut received = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let _ = app.emit("update-progress", (received, total));
            },
            || {},
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    install_and_restart(&app, update, bytes).await
}

/// Windows: the installer replaces the running app and exits it, so everything is saved
/// first (and the app restarts itself if the installer can't be started). macOS/Linux: the
/// bundle is replaced in place first, so a failure leaves the app fully working.
async fn install_and_restart(
    app: &AppHandle,
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
) -> CmdResult<()> {
    #[cfg(windows)]
    {
        shutdown_for_restart(app).await;
        tracing::info!("installing update {}", update.version);
        if let Err(e) = update.install(bytes) {
            tracing::error!("installing the update failed: {e}");
        }
        app.restart();
    }
    #[cfg(not(windows))]
    {
        tracing::info!("installing update {}", update.version);
        update
            .install(bytes)
            .map_err(|e| format!("Install failed: {e}"))?;
        shutdown_for_restart(app).await;
        app.restart();
    }
}

/// Checkpoint every download and remember what was running, so it continues after the restart.
async fn shutdown_for_restart(app: &AppHandle) {
    crate::QUITTING.store(true, Ordering::SeqCst);
    if let Some(core) = app.try_state::<Core>() {
        core.shutdown_for_restart().await;
    }
}
