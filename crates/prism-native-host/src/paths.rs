//! Location contract shared by the host and the app core.
//!
//! The app data directory is:
//!
//! | OS | Path |
//! |---|---|
//! | Windows | `%APPDATA%\Prism` (e.g. `C:\Users\me\AppData\Roaming\Prism`) |
//! | macOS | `~/Library/Application Support/Prism` |
//! | Linux / other Unix | `$XDG_DATA_HOME/prism` if `XDG_DATA_HOME` is set and absolute, else `~/.local/share/prism` |
//!
//! The env var `PRISM_DATA_DIR` overrides all of the above (used by tests and
//! dev setups; the app core must honour it too). Next, a `portable.txt` next to the
//! executable switches to `<exe dir>/data` (the Windows portable zip ships the host next
//! to `prism.exe`), exactly like the app core.
//!
//! Files inside the data dir:
//!
//! * `ipc.json` — written by the app: `{"port": u16, "token": "hex", "pid": u32, "version": "x.y.z"}`
//! * `logs/native-host.log` (+ `.1`) — host log (rotated at 1 MiB)
//! * `native-messaging/` — host manifests written by [`crate::registration`] (Windows)
//! * `app-path` — optional, written by the app: one absolute path of the app launcher
//!   (e.g. `$APPIMAGE`); used by the host to auto-launch the app
//! * `bin/prism-native-host` — copy of the host made by AppImage builds (stable path for manifests)

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Env var that overrides the data dir.
pub const DATA_DIR_ENV: &str = "PRISM_DATA_DIR";
/// Env var that overrides the path of the app executable the host launches.
pub const APP_PATH_ENV: &str = "PRISM_APP_PATH";
/// Env var that enables debug logging in the host.
pub const DEBUG_ENV: &str = "PRISM_HOST_DEBUG";

/// Name of the IPC discovery file inside the data dir.
pub const IPC_FILE_NAME: &str = "ipc.json";

fn non_empty(v: Option<OsString>) -> Option<OsString> {
    v.filter(|s| !s.is_empty())
}

/// Resolves the data dir from explicit inputs (pure, testable).
///
/// `os` is one of `"windows"`, `"macos"`, anything else is treated as Linux/Unix.
pub fn resolve_data_dir(
    os: &str,
    override_dir: Option<OsString>,
    appdata: Option<OsString>,
    home: Option<OsString>,
    xdg_data_home: Option<OsString>,
) -> Option<PathBuf> {
    if let Some(dir) = non_empty(override_dir) {
        return Some(PathBuf::from(dir));
    }
    match os {
        "windows" => non_empty(appdata).map(|a| PathBuf::from(a).join("ZeluxDL")),
        "macos" => non_empty(home).map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("ZeluxDL")
        }),
        _ => {
            if let Some(x) = non_empty(xdg_data_home) {
                // XDG requires an absolute path; ignore relative values.
                if x.to_string_lossy().starts_with('/') {
                    return Some(PathBuf::from(x).join("zeluxdl"));
                }
            }
            non_empty(home).map(|h| PathBuf::from(h).join(".local").join("share").join("zeluxdl"))
        }
    }
}

/// Marker file next to the executables that turns on portable mode.
pub const PORTABLE_MARKER: &str = "portable.txt";

/// Portable mode: `<exe dir>/data` when `portable.txt` sits next to `exe`. Must match
/// `prism_core::paths`, or the host looks for `ipc.json` where the portable app never
/// writes it and can't find the running app.
pub fn portable_data_dir(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    dir.join(PORTABLE_MARKER).exists().then(|| dir.join("data"))
}

/// The Prism app data dir for the current user (see module docs).
pub fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = non_empty(env::var_os(DATA_DIR_ENV)) {
        return Some(PathBuf::from(dir));
    }
    if let Some(dir) = env::current_exe().ok().and_then(|e| portable_data_dir(&e)) {
        return Some(dir);
    }
    resolve_data_dir(
        env::consts::OS,
        env::var_os(DATA_DIR_ENV),
        env::var_os("APPDATA"),
        home_dir_os(),
        env::var_os("XDG_DATA_HOME"),
    )
}

/// `<data dir>/ipc.json`.
pub fn ipc_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join(IPC_FILE_NAME))
}

/// `<data dir>/logs`.
pub fn logs_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("logs"))
}

/// `<data dir>/native-messaging` — where host manifests are written on Windows
/// (on Linux/macOS they go straight into each browser's directory).
pub fn manifests_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("native-messaging"))
}

/// Home dir (`HOME`, or `USERPROFILE` on Windows).
pub fn home_dir() -> Option<PathBuf> {
    home_dir_os().map(PathBuf::from)
}

fn home_dir_os() -> Option<OsString> {
    non_empty(env::var_os("HOME")).or_else(|| {
        if cfg!(windows) {
            non_empty(env::var_os("USERPROFILE"))
        } else {
            None
        }
    })
}

/// Name of the file (inside the data dir) in which the app records the
/// absolute path of its launcher (e.g. the `$APPIMAGE` file, whose mount path
/// changes on every run). One UTF-8 line, surrounding whitespace ignored.
pub const APP_PATH_FILE_NAME: &str = "app-path";

/// Resolution of the app executable to launch (pure, testable):
/// 1. `env_override` (`PRISM_APP_PATH`) if non-empty;
/// 2. the path stored in `<data dir>/app-path`, if that file exists and the target exists;
/// 3. the app binary next to `host_exe`.
pub fn resolve_app_executable(
    env_override: Option<OsString>,
    data_dir: Option<&Path>,
    host_exe: &Path,
) -> PathBuf {
    if let Some(p) = non_empty(env_override) {
        return PathBuf::from(p);
    }
    if let Some(dir) = data_dir
        && let Ok(text) = std::fs::read_to_string(dir.join(APP_PATH_FILE_NAME))
    {
        let line = text.trim().trim_start_matches('\u{feff}').trim();
        if !line.is_empty() {
            let p = PathBuf::from(line);
            if p.exists() {
                return p;
            }
        }
    }
    host_exe
        .parent()
        .map(|d| d.join(crate::APP_BINARY_NAME))
        .unwrap_or_else(|| PathBuf::from(crate::APP_BINARY_NAME))
}

/// Where the app executable is: `PRISM_APP_PATH` → `<data dir>/app-path` →
/// next to `host_exe` (see [`resolve_app_executable`]).
///
/// On macOS the host lives in `Prism.app/Contents/MacOS/` next to `prism`, so
/// the same "sibling file" rule applies on every OS. On Linux AppImage installs
/// the app copies the host to `<data dir>/bin/` and writes `app-path`.
pub fn app_executable(host_exe: &Path) -> PathBuf {
    resolve_app_executable(env::var_os(APP_PATH_ENV), data_dir().as_deref(), host_exe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn host_launches_the_zeluxdl_executable_next_to_it() {
        let host = Path::new(r"C:\ZeluxDL\zeluxdl-native-host.exe");
        assert_eq!(resolve_app_executable(None, None, host), PathBuf::from(r"C:\ZeluxDL\ZeluxDL.exe"));
    }

    fn os(s: &str) -> Option<OsString> {
        Some(OsString::from(s))
    }

    #[test]
    fn app_executable_resolution_order() {
        let dir = tempfile::tempdir().unwrap();
        let host = dir.path().join("bin").join(crate::HOST_BINARY_NAME);
        let sibling = dir.path().join("bin").join(crate::APP_BINARY_NAME);
        // 3. nothing configured → sibling of the host
        assert_eq!(
            resolve_app_executable(None, Some(dir.path()), &host),
            sibling
        );
        // app-path pointing at a missing target is ignored
        std::fs::write(
            dir.path().join(APP_PATH_FILE_NAME),
            "/nonexistent/Prism.AppImage\n",
        )
        .unwrap();
        assert_eq!(
            resolve_app_executable(None, Some(dir.path()), &host),
            sibling
        );
        // 2. app-path with an existing target (whitespace/BOM tolerated)
        let launcher = dir.path().join("Prism.AppImage");
        std::fs::write(&launcher, b"").unwrap();
        std::fs::write(
            dir.path().join(APP_PATH_FILE_NAME),
            format!("\u{feff}{}\r\n", launcher.display()),
        )
        .unwrap();
        assert_eq!(
            resolve_app_executable(None, Some(dir.path()), &host),
            launcher
        );
        // 1. env override wins (even over app-path)
        assert_eq!(
            resolve_app_executable(os("/custom/prism"), Some(dir.path()), &host),
            PathBuf::from("/custom/prism")
        );
        // empty env override is ignored
        assert_eq!(
            resolve_app_executable(os(""), Some(dir.path()), &host),
            launcher
        );
    }

    #[test]
    fn override_wins() {
        let d = resolve_data_dir("windows", os("X:/t"), os("C:/A"), None, None);
        assert_eq!(d, Some(PathBuf::from("X:/t")));
    }

    #[test]
    fn windows_appdata() {
        let d = resolve_data_dir(
            "windows",
            None,
            os("C:/Users/u/AppData/Roaming"),
            None,
            None,
        );
        assert_eq!(
            d,
            Some(PathBuf::from("C:/Users/u/AppData/Roaming").join("ZeluxDL"))
        );
    }

    #[test]
    fn linux_xdg_and_default() {
        let d = resolve_data_dir("linux", None, None, os("/home/u"), os("/data"));
        assert_eq!(d, Some(PathBuf::from("/data/zeluxdl")));
        // relative XDG_DATA_HOME is ignored per spec
        let d = resolve_data_dir("linux", None, None, os("/home/u"), os("rel"));
        assert_eq!(d, Some(PathBuf::from("/home/u/.local/share/zeluxdl")));
        let d = resolve_data_dir("linux", os(""), None, os("/home/u"), None);
        assert_eq!(d, Some(PathBuf::from("/home/u/.local/share/zeluxdl")));
    }

    #[test]
    fn macos() {
        let d = resolve_data_dir("macos", None, None, os("/Users/u"), None);
        assert_eq!(
            d,
            Some(PathBuf::from("/Users/u/Library/Application Support/ZeluxDL"))
        );
    }

    /// The portable zip puts the host next to `prism.exe` and `portable.txt`: the host must
    /// read `ipc.json` from the same `data` folder the portable app writes it to.
    #[test]
    fn portable_marker_moves_the_data_dir_next_to_the_exe() {
        let dir = tempfile::tempdir().unwrap();
        let host = dir.path().join(crate::HOST_BINARY_NAME);
        assert_eq!(portable_data_dir(&host), None);
        std::fs::write(dir.path().join(PORTABLE_MARKER), "portable").unwrap();
        assert_eq!(portable_data_dir(&host), Some(dir.path().join("data")));
    }
}
