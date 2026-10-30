//! Exact-post media extraction for social posts that yt-dlp cannot enumerate reliably.
//! gallery-dl is fetched lazily as a pinned standalone binary and verified before execution.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::{Result, VideoError};
use crate::model::{PlaylistEntry, PlaylistInfo, RequestContext, VideoOptions};
use crate::probe;
use crate::process;
use crate::tools::{self, Http, Tool, ToolProgress};

const RELEASE: &str = "2026.10.30";
const REPOSITORY: &str = "gdl-org/builds";

struct Asset {
    name: &'static str,
    sha256: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedMedia {
    url: String,
    extension: String,
    http_headers: BTreeMap<String, String>,
}

fn asset() -> Result<Asset> {
    let a = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Asset {
            name: "gallery-dl_windows.exe",
            sha256: "421476cfcac423adfd829cf54ce044821a91bc6ae51778d7c0a26d558b0270c5",
        },
        ("windows", "x86") => Asset {
            name: "gallery-dl_windows_x86.exe",
            sha256: "644f91db705b405e8369ea9e7071d1f6b9f7cacdda981329a36f931d8ea83328",
        },
        ("linux", "x86_64") => Asset {
            name: "gallery-dl_linux",
            sha256: "6d34c482ee808a2dd050a47eba0c63c8a493c7e5ccb52ce4ea6ad67193043b59",
        },
        ("macos", "x86_64") => Asset {
            name: "gallery-dl_macos",
            sha256: "9ddd7faa5b0bfac49502f34a1a8fa1cd4e811a859054e92086a022aa158e603e",
        },
        (os, arch) => {
            return Err(VideoError::Unsupported(format!(
                "social post media extraction is not packaged for {os}/{arch}"
            )));
        }
    };
    Ok(a)
}

fn binary_path(tools_dir: &Path) -> Result<(PathBuf, Asset)> {
    let a = asset()?;
    let name = format!(
        "gallery-dl-{RELEASE}{}",
        if a.name.ends_with(".exe") { ".exe" } else { "" }
    );
    Ok((tools_dir.join(name), a))
}

pub(crate) async fn ensure_binary(tools_dir: &Path, options: &VideoOptions) -> Result<PathBuf> {
    let (dest, a) = binary_path(tools_dir)?;
    if dest.is_file() {
        let p = dest.clone();
        if tokio::task::spawn_blocking(move || tools::sha256_file(&p).ok())
            .await
            .map_err(|e| VideoError::Other(e.to_string()))?
            .is_some_and(|hash| hash.eq_ignore_ascii_case(a.sha256))
        {
            return Ok(dest);
        }
        tokio::fs::remove_file(&dest).await?;
    }
    tokio::fs::create_dir_all(tools_dir).await?;
    let http = Http::new(options)?;
    let url = format!(
        "https://github.com/{REPOSITORY}/releases/download/{RELEASE}/{}",
        a.name
    );
    let tmp = tools::temp_path(tools_dir, "gallery-dl");
    let quiet = |_: ToolProgress| {};
    if let Err(e) = http
        .download_verified(Tool::YtDlp, &url, &tmp, a.sha256, &quiet)
        .await
    {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).await?;
    }
    if let Err(e) = tokio::fs::rename(&tmp, &dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    Ok(dest)
}

pub(crate) async fn extract_with_binary(
    exe: &Path,
    url: &str,
    ctx: &RequestContext,
    options: &VideoOptions,
) -> Result<PlaylistInfo> {
    let cookie_file = probe::write_cookie_file(url, ctx)?;
    let target = resolve_facebook_share(url, ctx, options.proxy.as_deref()).await?;
    let mut args = vec![
        "--config-ignore".to_owned(),
        "--no-input".to_owned(),
        "--dump-json".to_owned(),
        "--range".to_owned(),
        "1-500".to_owned(),
        "--no-mtime".to_owned(),
        "--option".to_owned(),
        "extractor.tiktok.audio=false".to_owned(),
        "--option".to_owned(),
        "extractor.twitter.quoted=false".to_owned(),
        "--option".to_owned(),
        "extractor.twitter.retweets=false".to_owned(),
        "--option".to_owned(),
        "extractor.twitter.replies=false".to_owned(),
    ];
    if let Some(file) = cookie_file.as_ref() {
        args.extend(["--cookies".into(), file.0.to_string_lossy().into_owned()]);
    } else if let Some(browser) = &options.cookies_from_browser {
        // Respect the user's existing browser-cookie setting for URLs pasted into the app.
        // Extension-supplied cookies take precedence so a locked browser DB is never needed.
        args.extend(["--cookies-from-browser".into(), browser.clone()]);
    }
    if let Some(ua) = ctx.user_agent.as_ref().or(options.user_agent.as_ref()) {
        args.extend(["--user-agent".into(), ua.clone()]);
    }
    if let Some(proxy) = &options.proxy {
        args.extend(["--proxy".into(), proxy.clone()]);
    }
    args.extend(["--".into(), target.clone()]);
    let output = process::run_capture(Tool::YtDlp, exe, args, Duration::from_secs(90)).await?;
    drop(cookie_file);
    if !output.status.success() {
        // Do not surface command output: extractors can echo signed media URLs or account data.
        return Err(VideoError::Other(format!(
            "gallery-dl could not read this {} post; it may require a logged-in browser session or may be unavailable",
            site_name(url)
        )));
    }
    let media = parse_media_entries(&String::from_utf8_lossy(&output.stdout))?;
    if media.is_empty() {
        return Err(VideoError::Other(format!(
            "no downloadable media was found in this {} post",
            site_name(url)
        )));
    }
    let entries = media
        .into_iter()
        .enumerate()
        .map(|(i, media)| PlaylistEntry {
            id: Some((i + 1).to_string()),
            title: Some(format!("{} {}", media_kind(&media.extension), i + 1)),
            extension: Some(media.extension),
            thumbnail: Some(media.url.clone()),
            url: media.url,
            http_headers: media.http_headers,
            ..Default::default()
        })
        .collect::<Vec<_>>();
    Ok(PlaylistInfo {
        id: None,
        title: Some(format!("{} post media", site_name(url))),
        uploader: None,
        webpage_url: Some(url.to_owned()),
        extractor: Some("ZeluxDL social post".into()),
        entries,
    })
}

async fn resolve_facebook_share(
    url: &str,
    ctx: &RequestContext,
    proxy: Option<&str>,
) -> Result<String> {
    if !url::Url::parse(url).ok().is_some_and(|u| {
        u.host_str().is_some_and(is_facebook_host) && u.path().starts_with("/share/")
    }) {
        return Ok(url.to_owned());
    }
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(20));
    if let Some(proxy) = proxy {
        builder = builder.proxy(reqwest::Proxy::all(proxy)?);
    }
    if let Some(ua) = &ctx.user_agent {
        builder = builder.user_agent(ua);
    }
    let client = builder.build()?;
    let mut request = client.get(url);
    if let Some(cookies) = &ctx.cookies {
        request = request.header(reqwest::header::COOKIE, cookies);
    }
    let response = request.send().await?;
    let final_url = response.url().clone();
    if !final_url.host_str().is_some_and(is_facebook_host) {
        return Err(VideoError::Other(
            "Facebook share link redirected outside Facebook".into(),
        ));
    }
    Ok(final_url.to_string())
}

fn is_facebook_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("facebook.com")
        || host.to_ascii_lowercase().ends_with(".facebook.com")
}

fn site_name(raw: &str) -> &'static str {
    let host = url::Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .unwrap_or_default();
    if host.contains("instagram") {
        "Instagram"
    } else if host.contains("tiktok") {
        "TikTok"
    } else if host.contains("facebook") || host == "fb.watch" {
        "Facebook"
    } else {
        "X"
    }
}

fn parse_media_entries(output: &str) -> Result<Vec<ResolvedMedia>> {
    const MAX_ITEMS: usize = 500;
    const VISUAL_EXTENSIONS: &[&str] = &[
        "jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "bmp", "tif", "tiff", "mp4", "webm",
        "mov", "m4v",
    ];
    let output: serde_json::Value = serde_json::from_str(output)?;
    let Some(rows) = output.as_array() else {
        return Err(VideoError::Other(
            "gallery-dl returned an invalid media list".into(),
        ));
    };
    let mut seen = HashSet::new();
    let mut media = Vec::new();
    for row in rows {
        let Some(fields) = row.as_array() else {
            continue;
        };
        if fields.len() < 3 || fields.first().and_then(serde_json::Value::as_i64) != Some(3) {
            continue;
        }
        let Some(raw_url) = fields[1].as_str() else {
            continue;
        };
        let Ok(url) = url::Url::parse(raw_url) else {
            continue;
        };
        if url.scheme() != "https" || url.host_str().is_none() {
            continue;
        }
        let metadata = &fields[2];
        let extension = match metadata
            .get("extension")
            .and_then(serde_json::Value::as_str)
        {
            Some(extension) => {
                let extension = extension.to_ascii_lowercase();
                VISUAL_EXTENSIONS
                    .contains(&extension.as_str())
                    .then_some(extension)
            }
            None => extension_from_url(&url).filter(|e| VISUAL_EXTENSIONS.contains(&e.as_str())),
        };
        let Some(extension) = extension else { continue };
        let http_headers = safe_http_headers(metadata.get("_http_headers"));
        let (url, canonical_key) = normalize_media_url(url, metadata, &extension);
        if seen.insert(canonical_key) {
            media.push(ResolvedMedia {
                url,
                extension,
                http_headers,
            });
            if media.len() == MAX_ITEMS {
                break;
            }
        }
    }
    Ok(media)
}

/// Preserve only ordinary request headers needed by public media CDNs. Cookies and hop-by-hop
/// or authority headers must never be copied into persisted download jobs from extractor output.
fn safe_http_headers(raw: Option<&serde_json::Value>) -> BTreeMap<String, String> {
    const ALLOWED: &[&str] = &[
        "accept",
        "accept-language",
        "origin",
        "referer",
        "user-agent",
    ];
    let Some(serde_json::Value::Object(headers)) = raw else {
        return BTreeMap::new();
    };
    headers
        .iter()
        .filter_map(|(name, value)| {
            let value = value.as_str()?;
            let lower = name.to_ascii_lowercase();
            (ALLOWED.contains(&lower.as_str())
                && !value.contains('\r')
                && !value.contains('\n')
                && value.len() <= 4096)
                .then(|| (name.clone(), value.to_owned()))
        })
        .collect()
}

fn normalize_media_url(
    mut url: url::Url,
    metadata: &serde_json::Value,
    extension: &str,
) -> (String, String) {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if (host == "pbs.twimg.com" || host.ends_with(".twimg.com"))
        && let Some(segment) = url.path_segments().and_then(|mut p| p.next_back())
    {
        let segment = segment.split(':').next().unwrap_or(segment);
        let media_id = segment
            .rsplit_once('.')
            .map_or(segment, |(id, _)| id)
            .to_owned();
        if !media_id.is_empty() {
            if host == "pbs.twimg.com" && url.path().contains("/media/") {
                url.set_path(&format!("/media/{media_id}"));
                url.set_query(None);
                url.query_pairs_mut()
                    .append_pair("format", extension)
                    .append_pair("name", "orig");
            }
            return (url.to_string(), format!("x-media:{media_id}"));
        }
    }
    if let Some(file_id) = metadata.get("file_id").and_then(serde_json::Value::as_str)
        && !file_id.is_empty()
    {
        let category = metadata
            .get("category")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("social");
        return (url.to_string(), format!("{category}:{file_id}"));
    }
    let canonical = format!("{}://{}{}", url.scheme(), host, url.path());
    (url.to_string(), canonical)
}

fn extension_from_url(url: &url::Url) -> Option<String> {
    url.path_segments()
        .and_then(|mut segments| segments.next_back())
        .and_then(|name| {
            name.rsplit_once('.')
                .map(|(_, ext)| ext.to_ascii_lowercase())
        })
        .filter(|ext| !ext.is_empty())
        .or_else(|| {
            url.query_pairs()
                .find(|(key, _)| {
                    key.eq_ignore_ascii_case("format") || key.eq_ignore_ascii_case("fm")
                })
                .map(|(_, value)| value.to_ascii_lowercase())
        })
}

fn media_kind(extension: &str) -> &'static str {
    if matches!(extension, "mp4" | "webm" | "mov" | "m4v") {
        "Video"
    } else {
        "Image"
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_media_entries, safe_http_headers};

    #[test]
    fn parses_deduplicated_image_and_video_entries_without_nonvisual_sidecars() {
        let output = r#"[[2, null, {"category":"twitter"}],[2,"https://cdn.example/not-a-file.jpg",{"extension":"jpg","type":"image"}],[3,"https://cdn.example/a",{"extension":"jpg","type":"image"}],[3,"https://cdn.example/a",{"extension":"jpg","type":"image"}],[3,"https://cdn.example/b",{"extension":"mp4","type":"video"}],[3,"https://cdn.example/c.jpg",{"extension":"mp3","type":"audio"}],[3,"http://cdn.example/d",{"extension":"jpg","type":"image"}],[3,"file:///tmp/e",{"extension":"png","type":"image"}],[3,"https://pbs.twimg.com/media/AbCdEf.jpg?name=small",{"category":"twitter","extension":"jpg","file_id":"AbCdEf"}],[3,"https://pbs.twimg.com/media/AbCdEf?format=jpg&name=large",{"category":"twitter","extension":"jpg","file_id":"AbCdEf"}]]"#;
        let entries = parse_media_entries(output).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].url, "https://cdn.example/a");
        assert_eq!(entries[0].extension, "jpg");
        assert_eq!(entries[1].url, "https://cdn.example/b");
        assert_eq!(entries[1].extension, "mp4");
        assert_eq!(
            entries[2].url,
            "https://pbs.twimg.com/media/AbCdEf?format=jpg&name=orig"
        );
        assert_eq!(entries[2].extension, "jpg");
    }

    #[test]
    fn preserves_only_safe_asset_headers_and_never_cookies() {
        let headers = safe_http_headers(Some(&serde_json::json!({
            "User-Agent": "Example browser",
            "Referer": "https://www.tiktok.com/@user/photo/123",
            "Origin": "https://www.tiktok.com",
            "Accept": "image/avif,image/webp,*/*",
            "Cookie": "session=secret",
            "Host": "attacker.example",
            "Content-Length": "99",
            "X-Injected": "bad",
            "X-Newline": "safe\\r\\nInjected: yes"
        })));
        assert_eq!(headers.len(), 4);
        assert_eq!(
            headers.get("User-Agent").map(String::as_str),
            Some("Example browser")
        );
        assert!(
            !headers
                .keys()
                .any(|name| name.eq_ignore_ascii_case("cookie"))
        );
        assert!(!headers.contains_key("X-Newline"));
    }

    #[test]
    fn reads_asset_headers_from_dump_json_metadata() {
        let entries = parse_media_entries(
            r#"[[3,"https://cdn.example/asset",{"extension":"jpg","_http_headers":{"Referer":"https://www.instagram.com/p/abc/","User-Agent":"Browser","Cookie":"session=secret"}}]]"#,
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].http_headers.get("Referer").unwrap(),
            "https://www.instagram.com/p/abc/"
        );
        assert!(!entries[0].http_headers.contains_key("Cookie"));
    }
}
