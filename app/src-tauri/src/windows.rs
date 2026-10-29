//! Secondary windows: capture dialogs, details, completion, mini mode, drop zone.
//!
//! Every window loads the same SPA; the hash route (`#/capture/<id>`) selects the view.

use prism_core::manager::Core;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

struct Spec {
    width: f64,
    height: f64,
    always_on_top: bool,
    resizable: bool,
    title: &'static str,
    /// Smallest the user can resize to. `None` falls back to the generic
    /// `width.min(420) × height.min(240)` — fine for simple forms, but windows with a fixed
    /// footer (buttons that must not get squeezed against its own edges) or a multi-section
    /// layout (content that can overlap the footer if the window gets too short) need a real
    /// floor instead.
    min_size: Option<(f64, f64)>,
}

fn spec(kind: &str) -> Spec {
    let s = |width, height, always_on_top, resizable, title| Spec {
        width,
        height,
        always_on_top,
        resizable,
        title,
        min_size: None,
    };
    match kind {
        "capture" => s(600.0, 440.0, true, false, "Download File"),
        "batch" => s(820.0, 600.0, true, true, "Download Links"),
        "video" => s(680.0, 640.0, true, true, "Download Video"),
        "complete" => s(500.0, 300.0, true, false, "Download Complete"),
        "details" => Spec {
            min_size: Some((640.0, 480.0)),
            ..s(760.0, 600.0, false, true, "Download Details")
        },
        // The auto-opened progress popup: header + connections only, no speed chart/stats —
        // matches IDM's simpler always-on progress dialog, so it's shorter than "details".
        "progress" => Spec {
            min_size: Some((640.0, 340.0)),
            ..s(700.0, 420.0, false, true, "Downloading")
        },
        "torrent" => s(680.0, 600.0, true, true, "Add Torrent"),
        "model" => Spec {
            min_size: Some((600.0, 520.0)),
            ..s(760.0, 680.0, false, true, "Download Model")
        },
        "addurl" => s(600.0, 300.0, true, false, "Add URL"),
        "mini" => s(360.0, 220.0, true, false, "ZeluxDL Mini"),
        "dropzone" => s(112.0, 112.0, true, false, "ZeluxDL Drop Zone"),
        _ => s(720.0, 560.0, false, true, "ZeluxDL"),
    }
}

/// Windows are shown as soon as they are created, not after the page's first paint:
/// * macOS: WKWebView doesn't render into a hidden window.
/// * Linux (#30): a WebKitGTK window that goes from hidden to shown sometimes stays blank on KDE
///   Plasma (#18 was the same for a window shown again from the tray). The windows are
///   transparent, so one shown before its page paints has nothing to flash.
///
/// Windows (WebView2) keeps them hidden until the first paint, so no white frame shows.
pub const SHOW_ON_CREATE: bool = cfg!(any(target_os = "macos", target_os = "linux"));

/// Open (or focus) a window for `kind` with an optional entity id.
pub fn open(app: &AppHandle, kind: &str, id: Option<&str>) -> tauri::Result<WebviewWindow> {
    let label = match id {
        Some(id) => format!("{kind}-{id}"),
        None => kind.to_string(),
    };
    if let Some(w) = app.get_webview_window(&label) {
        bring_app_forward(app, kind);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(w);
    }
    // A `#` inside WebviewUrl::App is percent-encoded into the path, so the page is loaded
    // plainly and the hash route is set before any app script runs.
    let route = match id {
        Some(id) => format!("/{kind}/{id}"),
        None => format!("/{kind}"),
    };
    let sp = spec(kind);
    let (min_w, min_h) = sp
        .min_size
        .unwrap_or((sp.width.min(420.0), sp.height.min(240.0)));
    let init = format!("if (!location.hash) history.replaceState(null, '', '#{route}');");
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .initialization_script(&init)
        .title(sp.title)
        .inner_size(sp.width, sp.height)
        .min_inner_size(min_w, min_h)
        .resizable(sp.resizable)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(sp.always_on_top)
        .skip_taskbar(matches!(kind, "mini" | "dropzone"))
        // Windows: hidden until the page has painted (no white flash). macOS and Linux: shown
        // right away (see `SHOW_ON_CREATE`). Corner windows are positioned first and shown below.
        .visible(SHOW_ON_CREATE && !matches!(kind, "mini" | "dropzone"))
        // HTML5 drag & drop (links from the browser) instead of Tauri's file-only handler.
        .disable_drag_drop_handler()
        .focused(!matches!(kind, "mini" | "dropzone"));
    let builder = if matches!(kind, "mini" | "dropzone") {
        builder
    } else {
        builder.center()
    };
    let window = builder.build()?;
    if matches!(kind, "mini" | "dropzone") {
        place_bottom_right(&window, kind == "dropzone");
        if SHOW_ON_CREATE {
            let _ = window.show();
        }
    }
    bring_app_forward(app, kind);
    // The page calls `show()` itself once it has rendered (no white flash). A webview that
    // never paints while hidden (WKWebView can pause animation frames for invisible windows)
    // must not leave the dialog invisible, so show it anyway after a moment.
    let fallback = window.clone();
    let what = label.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if !fallback.is_visible().unwrap_or(true) {
            tracing::warn!("window {what} did not show itself; showing it");
            let _ = fallback.show();
            let _ = fallback.set_focus();
        }
    });
    tracing::info!("opened window {label}");
    Ok(window)
}

/// On macOS a background app's new window opens behind the browser; activate the app so
/// dialogs (Download File, video picker, …) come to the front.
fn bring_app_forward(app: &AppHandle, kind: &str) {
    #[cfg(target_os = "macos")]
    if !matches!(kind, "mini" | "dropzone") {
        let _ = app.show();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, kind);
}

fn place_bottom_right(window: &WebviewWindow, higher: bool) {
    if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
        let area = monitor.work_area();
        let margin = (24.0 * monitor.scale_factor()) as i32;
        let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
        let lift = if higher {
            (260.0 * monitor.scale_factor()) as i32
        } else {
            0
        };
        let y = area.position.y + area.size.height as i32 - size.height as i32 - margin - lift;
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

pub fn open_details(app: &AppHandle, id: &str) -> tauri::Result<()> {
    open(app, "details", Some(id)).map(|_| ())
}

/// The auto-opened progress popup — a distinct window kind from `open_details` so it never
/// collides with (or gets reused by) a manually-opened full details window for the same item.
pub fn open_progress(app: &AppHandle, id: &str) -> tauri::Result<()> {
    open(app, "progress", Some(id)).map(|_| ())
}

/// Closes the auto-opened progress popup for `id`, if one is open (used when the download
/// finishes — the completion dialog takes over, so the simpler popup doesn't need to linger).
pub fn close_progress(app: &AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window(&format!("progress-{id}")) {
        let _ = w.close();
    }
}

fn toggle(app: &AppHandle, kind: &str) -> tauri::Result<bool> {
    if let Some(w) = app.get_webview_window(kind) {
        w.close()?;
        Ok(false)
    } else {
        open(app, kind, None)?;
        Ok(true)
    }
}

pub fn toggle_mini(app: &AppHandle) -> tauri::Result<bool> {
    toggle(app, "mini")
}

pub fn toggle_dropzone(app: &AppHandle) -> tauri::Result<bool> {
    toggle(app, "dropzone")
}

/// How long the main window waits hidden in the tray before it is closed to free its web view's
/// memory (#11: WebView2 keeps 100+ MB that downloads don't need). Opening Prism creates a new
/// one; a quick close and reopen keeps the same window.
#[cfg(not(target_os = "macos"))]
const RELEASE_HIDDEN_MAIN_AFTER: Duration = Duration::from_secs(60);

/// Set once the user opens the main window, so a newly created one shows itself after its first
/// paint (see `commands::main_window_starts_visible`).
pub static MAIN_WANTED: AtomicBool = AtomicBool::new(false);
/// A new main window is on its way; another "Open Prism" meanwhile has nothing to do.
static CREATING_MAIN: AtomicBool = AtomicBool::new(false);
/// Counts trips to the tray and reopenings: only the latest trip's timer may close the window.
#[cfg(not(target_os = "macos"))]
static TRAY_TRIP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn show_main(app: &AppHandle) {
    MAIN_WANTED.store(true, Ordering::SeqCst);
    #[cfg(not(target_os = "macos"))]
    TRAY_TRIP.fetch_add(1, Ordering::SeqCst);
    if CREATING_MAIN.load(Ordering::SeqCst) {
        return;
    }
    match app.get_webview_window("main") {
        // Linux (#18): a transparent WebKitGTK window that was hidden can come back without
        // painting anything — invisible, though the desktop shows it as open (KDE Plasma). A new
        // window always paints, so a hidden main window is replaced instead of shown again.
        Some(w) if cfg!(target_os = "linux") && !w.is_visible().unwrap_or(true) => {
            let _ = w.destroy();
            create_main(app);
        }
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        None => create_main(app),
    }
}

/// Creates the main window again from its configuration (it was closed while in the tray).
fn create_main(app: &AppHandle) {
    if CREATING_MAIN.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    // Off the caller's thread: building a window inside an event handler can deadlock WebView2.
    std::thread::spawn(move || {
        // A window that is being destroyed keeps its label for a moment.
        for _ in 0..60 {
            if app.get_webview_window("main").is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let built = (|| -> tauri::Result<WebviewWindow> {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|c| c.label == "main")
                .cloned()
                .ok_or(tauri::Error::WindowNotFound)?;
            WebviewWindowBuilder::from_config(&app, &config)?.build()
        })();
        CREATING_MAIN.store(false, Ordering::SeqCst);
        match built {
            Ok(window) => {
                tracing::info!("opened the main window again");
                crate::apply_window_material(&window, &app.state::<Core>().settings());
                // macOS and Linux show it now (see `SHOW_ON_CREATE`).
                if SHOW_ON_CREATE {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                // The page shows the window after its first paint; this is only a fallback.
                std::thread::sleep(Duration::from_millis(1500));
                if !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Err(e) => tracing::error!("could not open the main window: {e}"),
        }
    });
}

/// The main window went to the tray, or Prism started there: after a while the hidden window is
/// closed to free its memory (#11), and `show_main` creates it again. macOS keeps it.
pub fn release_main_later(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        let trip = TRAY_TRIP.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(RELEASE_HIDDEN_MAIN_AFTER);
            if TRAY_TRIP.load(Ordering::SeqCst) != trip || CREATING_MAIN.load(Ordering::SeqCst) {
                return;
            }
            if let Some(w) = app.get_webview_window("main")
                && !w.is_visible().unwrap_or(true)
            {
                tracing::info!("closed the hidden main window to free its memory");
                let _ = w.destroy();
            }
        });
    }
    #[cfg(target_os = "macos")]
    let _ = app;
}
