//! Loopback HTTP client to the running app, plus app auto-launch.

use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use crate::protocol::codes;
use crate::{log_debug, log_error, log_info};

/// How long to wait for a launched app to come up.
pub const LAUNCH_WAIT: Duration = Duration::from_secs(8);
/// Loopback connect timeout. Windows retries SYNs to a closed port for ~2 s,
/// so a short timeout here is what keeps "app not running" detection fast.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(600);
/// Largest reply body we read from the app.
const MAX_REPLY_BYTES: u64 = 16 * 1024 * 1024;

/// Contents of `ipc.json` (written by the app).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct IpcInfo {
    pub port: u16,
    pub token: String,
    #[serde(default)]
    pub pid: u32,
    #[serde(default)]
    pub version: String,
}

/// Reads and parses `ipc.json`; `None` if missing or invalid.
pub fn read_ipc(path: &Path) -> Option<IpcInfo> {
    let bytes = fs::read(path).ok()?;
    let info: IpcInfo = serde_json::from_slice(&bytes).ok()?;
    (info.port != 0 && !info.token.is_empty()).then_some(info)
}

type Stamp = (Option<std::time::SystemTime>, u64);

fn stamp_of(path: &Path) -> Option<Stamp> {
    let m = fs::metadata(path).ok()?;
    Some((m.modified().ok(), m.len()))
}

/// A failed exchange with the app: `(error code, message)`.
pub type SendError = (&'static str, String);

enum Attempt {
    Reply(Value),
    NotRunning(String),
    Unauthorized,
    Fail(&'static str, String),
}

/// Talks to the app and launches it when needed. Shared by all request threads.
pub struct AppClient {
    agent: ureq::Agent,
    ipc_path: Option<PathBuf>,
    app_exe: PathBuf,
    /// Parsed ipc.json plus the (mtime, len) stamp it was read at.
    cached: Mutex<Option<(IpcInfo, Stamp)>>,
    launch_lock: Mutex<()>,
}

impl AppClient {
    pub fn new(ipc_path: Option<PathBuf>, app_exe: PathBuf) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .proxy(None)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .max_idle_connections_per_host(4)
            .build()
            .into();
        AppClient {
            agent,
            ipc_path,
            app_exe,
            cached: Mutex::new(None),
            launch_lock: Mutex::new(()),
        }
    }

    /// Returns ipc.json's content. A cheap `stat` per call detects a removed or
    /// rewritten file (app exited / restarted) without waiting for a connect timeout.
    fn load_ipc(&self, force: bool) -> Option<IpcInfo> {
        let path = self.ipc_path.as_deref()?;
        let stamp = stamp_of(path);
        let mut c = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        let Some(stamp) = stamp else {
            *c = None;
            return None;
        };
        let fresh = matches!(&*c, Some((_, s)) if *s == stamp);
        if force || !fresh {
            *c = read_ipc(path).map(|i| (i, stamp));
        }
        c.as_ref().map(|(i, _)| i.clone())
    }

    fn post(&self, info: &IpcInfo, body: &[u8], timeout: Duration) -> Attempt {
        let url = format!("http://127.0.0.1:{}/v1/message", info.port);
        let res = self
            .agent
            .post(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(timeout))
            .build()
            .send(body);
        let mut resp = match res {
            Ok(r) => r,
            Err(e) => return classify_error(e),
        };
        let status = resp.status().as_u16();
        let bytes = match resp
            .body_mut()
            .with_config()
            .limit(MAX_REPLY_BYTES)
            .read_to_vec()
        {
            Ok(b) => b,
            Err(e) => return classify_error(e),
        };
        match status {
            200..=299 => match serde_json::from_slice::<Value>(&bytes) {
                Ok(v) => Attempt::Reply(v),
                Err(e) => Attempt::Fail(codes::BAD_REPLY, format!("app reply is not JSON: {e}")),
            },
            401 | 403 => Attempt::Unauthorized,
            s => {
                // The app may still have sent a structured error object.
                if let Ok(v @ Value::Object(_)) = serde_json::from_slice::<Value>(&bytes)
                    && v.get("ok").is_some()
                {
                    return Attempt::Reply(v);
                }
                let text = String::from_utf8_lossy(&bytes);
                Attempt::Fail(
                    codes::APP_ERROR,
                    format!(
                        "app answered HTTP {s}: {}",
                        text.chars().take(300).collect::<String>()
                    ),
                )
            }
        }
    }

    /// `GET /v1/health` → true on 2xx.
    fn healthy(&self, info: &IpcInfo) -> bool {
        let url = format!("http://127.0.0.1:{}/v1/health", info.port);
        self.agent
            .get(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .config()
            .timeout_global(Some(Duration::from_millis(1500)))
            .build()
            .call()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    /// Sends `body` (the raw message JSON) to the app and returns its reply object.
    pub fn send(
        &self,
        body: &[u8],
        timeout: Duration,
        allow_launch: bool,
    ) -> Result<Value, SendError> {
        let mut info = self.load_ipc(false);
        let mut reread = false;
        let mut launched = false;
        loop {
            let attempt = match &info {
                Some(i) => self.post(i, body, timeout),
                None => Attempt::NotRunning("ipc.json not found".into()),
            };
            let attempt = match attempt {
                Attempt::Reply(v) => return Ok(v),
                Attempt::Fail(code, msg) => return Err((code, msg)),
                other => other,
            };
            // Unauthorized / not running: the app may have restarted with a
            // new port or token, so re-read ipc.json once before giving up.
            if !reread {
                reread = true;
                let fresh = self.load_ipc(true);
                let changed = fresh.is_some() && fresh != info;
                info = fresh;
                if changed {
                    continue;
                }
            }
            match attempt {
                Attempt::NotRunning(why) => {
                    if !allow_launch {
                        return Err((
                            codes::APP_NOT_RUNNING,
                            format!("ZeluxDL is not running ({why})"),
                        ));
                    }
                    if launched {
                        return Err((codes::APP_UNREACHABLE, why));
                    }
                    launched = true;
                    info = Some(self.ensure_running()?);
                }
                _ => return Err((codes::UNAUTHORIZED, "the app rejected the IPC token".into())),
            }
        }
    }

    /// Launches the app (once, even with concurrent callers) and waits until
    /// `ipc.json` exists and `/v1/health` answers, for up to [`LAUNCH_WAIT`].
    pub fn ensure_running(&self) -> Result<IpcInfo, SendError> {
        let _guard = self.launch_lock.lock().unwrap_or_else(|e| e.into_inner());
        // Someone else may have launched it while we waited for the lock.
        if let Some(i) = self.load_ipc(true)
            && self.healthy(&i)
        {
            return Ok(i);
        }
        let started = Instant::now();
        // ipc.json from a previous run must not be mistaken for the new instance.
        let stale = self.load_ipc(false);
        launch_app(&self.app_exe).map_err(|e| {
            log_error!("launching {} failed: {e}", self.app_exe.display());
            (
                codes::APP_UNREACHABLE,
                format!("could not start ZeluxDL ({}): {e}", self.app_exe.display()),
            )
        })?;
        log_info!("launched {} --background", self.app_exe.display());
        while started.elapsed() < LAUNCH_WAIT {
            thread::sleep(Duration::from_millis(60));
            if let Some(i) = self.load_ipc(true) {
                // A stale file is fine as soon as health answers on it.
                if (Some(&i) != stale.as_ref() || started.elapsed() > Duration::from_millis(300))
                    && self.healthy(&i)
                {
                    log_debug!("app up after {:?}", started.elapsed());
                    return Ok(i);
                }
            }
        }
        Err((
            codes::APP_UNREACHABLE,
            format!("ZeluxDL did not start within {} s", LAUNCH_WAIT.as_secs()),
        ))
    }
}

fn classify_error(e: ureq::Error) -> Attempt {
    use std::io::ErrorKind;
    match e {
        ureq::Error::Timeout(ureq::Timeout::Connect) => {
            Attempt::NotRunning("connect timed out".into())
        }
        ureq::Error::Timeout(t) => Attempt::Fail(
            codes::TIMEOUT,
            format!("the app did not answer in time ({t:?})"),
        ),
        ureq::Error::ConnectionFailed => Attempt::NotRunning("connection failed".into()),
        ureq::Error::Io(io)
            if matches!(
                io.kind(),
                ErrorKind::ConnectionRefused
                    | ErrorKind::ConnectionReset
                    | ErrorKind::ConnectionAborted
                    | ErrorKind::NotConnected
                    | ErrorKind::AddrNotAvailable
            ) =>
        {
            Attempt::NotRunning(format!("{io}"))
        }
        other => Attempt::Fail(codes::APP_ERROR, format!("{other}")),
    }
}

/// Starts `exe --background`, fully detached (no console window on Windows,
/// own process group on Unix, all stdio to null so it can never write into
/// the native messaging pipe).
pub fn launch_app(exe: &Path) -> std::io::Result<()> {
    if !exe.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "app executable not found",
        ));
    }
    let make = || {
        let mut cmd = Command::new(exe);
        cmd.arg("--background")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir);
        }
        cmd
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let base = CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // Browsers put the host in a job object that is killed with the port;
        // break away so the app survives. Not every job allows it → retry.
        let mut cmd = make();
        cmd.creation_flags(base | CREATE_BREAKAWAY_FROM_JOB);
        match cmd.spawn() {
            Ok(_) => Ok(()),
            Err(e) => {
                log_debug!("spawn with breakaway failed ({e}), retrying without");
                let mut cmd = make();
                cmd.creation_flags(base);
                cmd.spawn().map(|_| ())
            }
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let mut cmd = make();
        cmd.process_group(0);
        cmd.spawn().map(|_| ())
    }
    #[cfg(not(any(windows, unix)))]
    {
        make().spawn().map(|_| ())
    }
}
