//! Domain types shared by storage, the manager and the UI (serialized camelCase).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Milliseconds since the Unix epoch.
pub type Timestamp = i64;

pub fn now_ms() -> Timestamp {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    #[default]
    Http,
    Ftp,
    Hls,
    Dash,
    Video,
    Torrent,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemKind::Http => "http",
            ItemKind::Ftp => "ftp",
            ItemKind::Hls => "hls",
            ItemKind::Dash => "dash",
            ItemKind::Video => "video",
            ItemKind::Torrent => "torrent",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "ftp" => ItemKind::Ftp,
            "hls" => ItemKind::Hls,
            "dash" => ItemKind::Dash,
            "video" => ItemKind::Video,
            "torrent" => ItemKind::Torrent,
            _ => ItemKind::Http,
        }
    }

    /// Guess the job kind from a URL.
    pub fn from_url(url: &str) -> Self {
        let lower = url.to_ascii_lowercase();
        let path = lower.split(['?', '#']).next().unwrap_or("");
        if lower.starts_with("magnet:") || path.ends_with(".torrent") {
            ItemKind::Torrent
        } else if lower.starts_with("ftp://") || lower.starts_with("ftps://") {
            ItemKind::Ftp
        } else if path.ends_with(".m3u8") {
            ItemKind::Hls
        } else if path.ends_with(".mpd") {
            ItemKind::Dash
        } else {
            ItemKind::Http
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Added but not started ("Download later").
    #[default]
    Idle,
    /// Waiting for a free slot in its queue.
    Queued,
    Connecting,
    Downloading,
    Retrying,
    Paused,
    /// Post-processing: muxing, verifying checksum, antivirus scan.
    Processing,
    Completed,
    Failed,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Idle => "idle",
            Status::Queued => "queued",
            Status::Connecting => "connecting",
            Status::Downloading => "downloading",
            Status::Retrying => "retrying",
            Status::Paused => "paused",
            Status::Processing => "processing",
            Status::Completed => "completed",
            Status::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "queued" => Status::Queued,
            "connecting" => Status::Connecting,
            "downloading" => Status::Downloading,
            "retrying" => Status::Retrying,
            "paused" => Status::Paused,
            "processing" => Status::Processing,
            "completed" => Status::Completed,
            "failed" => Status::Failed,
            _ => Status::Idle,
        }
    }

    /// A job is running (holds a queue slot).
    pub fn is_active(self) -> bool {
        matches!(
            self,
            Status::Connecting | Status::Downloading | Status::Retrying | Status::Processing
        )
    }

    pub fn is_finished(self) -> bool {
        self == Status::Completed
    }
}

/// One entry of the download list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub kind: ItemKind,
    pub url: String,
    pub final_url: Option<String>,
    pub file_name: String,
    pub save_dir: PathBuf,
    pub size: Option<u64>,
    pub downloaded: u64,
    pub status: Status,
    pub error: Option<String>,
    pub category: String,
    pub queue_id: Option<String>,
    pub description: String,
    pub referer: Option<String>,
    pub added_at: Timestamp,
    pub last_try_at: Option<Timestamp>,
    pub finished_at: Option<Timestamp>,
    pub resumable: Option<bool>,
    pub connections: u8,
    /// Per-download limit in bytes/s (0 = none).
    pub speed_limit: u64,
    /// Expected checksum as `algo:hex`.
    pub checksum: Option<String>,
    pub trashed: bool,
    /// Order inside its queue.
    pub position: i64,
    pub mirrors: Vec<String>,
    pub grabber_project: Option<String>,
    /// Serialized `prism_engine::DownloadRequest` (or video/torrent job spec).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<serde_json::Value>,
    /// Serialized engine resume state (never sent to the UI).
    #[serde(skip)]
    pub resume: Option<serde_json::Value>,
    /// Video job details (title, thumbnail, chosen format) for UI display.
    pub media: Option<MediaInfo>,
}

impl DownloadItem {
    pub fn path(&self) -> PathBuf {
        self.save_dir.join(&self.file_name)
    }
}

/// Extra info for video/stream items shown in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub quality: Option<String>,
    pub site: Option<String>,
    pub page_url: Option<String>,
    /// 1-based position in the playlist it was picked from.
    pub playlist_index: Option<u32>,
    /// Files selected together from one social post share a completion notice.
    pub download_group: Option<String>,
    /// Identical content already exists at another completed download's path.
    pub duplicate_of: Option<String>,
}

/// Live, non-persisted progress of a running item (sent ~4×/s to the UI).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub status: Status,
    pub downloaded: u64,
    pub size: Option<u64>,
    pub speed: u64,
    pub eta_secs: Option<u64>,
    pub connections: u32,
    /// Human-readable detail: "Muxing", "Retrying in 4 s", ...
    pub detail: Option<String>,
}

/// Segment layout for the details window visualization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SegmentInfo {
    pub start: u64,
    pub pos: u64,
    pub end: u64,
    pub speed: u64,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub extensions: Vec<String>,
    /// Absolute folder; `None` → `<default dir>/<name>` (or default dir when category folders are off).
    pub save_dir: Option<PathBuf>,
    pub builtin: bool,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub id: String,
    pub name: String,
    pub max_concurrent: u32,
    /// Bytes/s (0 = unlimited).
    pub speed_limit: u64,
    pub position: i64,
    pub builtin: bool,
    pub schedule: Schedule,
    /// Whether the queue is currently processing (started by user or schedule).
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Schedule {
    pub enabled: bool,
    /// "HH:MM" local time.
    pub start_time: Option<String>,
    pub stop_time: Option<String>,
    /// ISO weekdays 1 = Monday … 7 = Sunday. Empty = every day.
    pub days: Vec<u8>,
    /// Run once on `date` ("YYYY-MM-DD") instead of repeating.
    pub once_date: Option<String>,
    /// Re-check failed items when the queue starts.
    pub retry_failed: bool,
    pub on_complete: PostAction,
    /// Wake the computer from sleep to start (where supported).
    pub wake: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum PostAction {
    #[default]
    None,
    Exit,
    Sleep,
    Hibernate,
    Shutdown,
    Lock,
    Sound,
    Command(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GrabberProject {
    pub id: String,
    pub name: String,
    pub config: serde_json::Value,
    pub results: serde_json::Value,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}
