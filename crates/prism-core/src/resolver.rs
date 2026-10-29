//! Multi-host direct download URL resolver.
//!
//! Converts web viewer and share links from major storage hosts into
//! high-speed, direct resumable download links.

use url::Url;

/// Resolves a sharing/viewer URL from popular hosting providers into a direct download link.
/// Returns `Some(resolved_url)` if a transformation was applied, or `None` if no change was needed.
pub fn resolve_url(raw_url: &str) -> Option<String> {
    let mut parsed = Url::parse(raw_url).ok()?;
    let host = parsed.host_str()?.to_lowercase();

    // 1. Google Drive & Google Docs / Sheets / Slides
    if host == "drive.google.com" || host == "docs.google.com" {
        if let Some(file_id) = extract_google_file_id(&parsed) {
            let path = parsed.path();
            if path.contains("/document/d/") {
                return Some(format!(
                    "https://docs.google.com/document/d/{file_id}/export?format=docx"
                ));
            }
            if path.contains("/spreadsheets/d/") {
                return Some(format!(
                    "https://docs.google.com/spreadsheets/d/{file_id}/export?format=xlsx"
                ));
            }
            if path.contains("/presentation/d/") {
                return Some(format!(
                    "https://docs.google.com/presentation/d/{file_id}/export/pptx"
                ));
            }
            return Some(format!(
                "https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
            ));
        }
    }

    // 2. Dropbox: force direct download param dl=1
    if host == "dropbox.com" || host.ends_with(".dropbox.com") {
        if host != "dl.dropboxusercontent.com" {
            let mut pairs: Vec<(String, String)> = parsed
                .query_pairs()
                .filter(|(k, _)| k != "raw" && k != "dl")
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            pairs.push(("dl".to_string(), "1".to_string()));
            parsed.set_query(None);
            for (k, v) in pairs {
                parsed.query_pairs_mut().append_pair(&k, &v);
            }
            let res = parsed.to_string();
            if res != raw_url {
                return Some(res);
            }
        }
    }

    // 3. Pixeldrain: convert /u/<id> or /file/<id> to API download endpoint
    if host == "pixeldrain.com" || host == "www.pixeldrain.com" {
        let path = parsed.path();
        if let Some(id) = path
            .strip_prefix("/u/")
            .or_else(|| path.strip_prefix("/file/"))
        {
            let clean_id = id.trim_matches('/');
            if !clean_id.is_empty() && !clean_id.contains('/') {
                return Some(format!("https://pixeldrain.com/api/file/{clean_id}?download"));
            }
        }
    }

    // 4. OneDrive & SharePoint: append download=1
    if host == "1drv.ms" || host == "onedrive.live.com" || host.ends_with(".sharepoint.com") {
        let has_dl = parsed.query_pairs().any(|(k, v)| k == "download" && v == "1");
        if !has_dl {
            parsed.query_pairs_mut().append_pair("download", "1");
            return Some(parsed.to_string());
        }
    }

    // 5. VikingFile: normalize vik1ngfile.site to vikingfile.com
    if host == "vik1ngfile.site" || host == "www.vik1ngfile.site" {
        if parsed.set_host(Some("vikingfile.com")).is_ok() {
            return Some(parsed.to_string());
        }
    }

    // 6. Hugging Face: blob -> resolve with download=true
    if host == "huggingface.co" {
        let path = parsed.path().to_string();
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        if let Some(blob_idx) = segments.iter().position(|&s| s == "blob") {
            if blob_idx >= 1 && blob_idx < segments.len() - 1 {
                let mut new_segments = segments.clone();
                new_segments[blob_idx] = "resolve";
                let new_path = format!("/{}", new_segments.join("/"));
                parsed.set_path(&new_path);
                if !parsed.query_pairs().any(|(k, _)| k == "download") {
                    parsed.query_pairs_mut().append_pair("download", "true");
                }
                return Some(parsed.to_string());
            }
        }
    }

    // 7. GitHub: blob view -> raw.githubusercontent.com
    if host == "github.com" {
        let path = parsed.path().to_string();
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        if segments.len() >= 4 && segments[2] == "blob" {
            // format: /user/repo/blob/branch/path...
            let user = segments[0];
            let repo = segments[1];
            let branch_and_path = segments[3..].join("/");
            return Some(format!(
                "https://raw.githubusercontent.com/{user}/{repo}/{branch_and_path}"
            ));
        }
    }

    // 8. GitLab: blob view -> raw
    if host == "gitlab.com" {
        let path = parsed.path().to_string();
        if path.contains("/-/blob/") {
            let new_path = path.replace("/-/blob/", "/-/raw/");
            parsed.set_path(&new_path);
            return Some(parsed.to_string());
        }
    }

    // 9. Pastebin: view -> raw
    if host == "pastebin.com" || host == "www.pastebin.com" {
        let path = parsed.path().trim_start_matches('/');
        if !path.is_empty() && !path.starts_with("raw/") && !path.contains('/') {
            return Some(format!("https://pastebin.com/raw/{path}"));
        }
    }

    // 10. GitHub Gist: view -> raw
    if host == "gist.github.com" {
        let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
        if segments.len() == 2 && segments[1] != "raw" {
            let user = segments[0];
            let id = segments[1];
            return Some(format!("https://gist.githubusercontent.com/{user}/{id}/raw"));
        }
    }

    // 11. Buzzheavier: /f/{id} -> /{id}
    if host == "buzzheavier.com" || host == "www.buzzheavier.com" {
        let path = parsed.path();
        if let Some(id) = path.strip_prefix("/f/") {
            let clean_id = id.trim_matches('/');
            if !clean_id.is_empty() {
                return Some(format!("https://buzzheavier.com/{clean_id}"));
            }
        }
    }

    None
}

/// Asynchronous resolver that handles both synchronous URL transformations and
/// dynamic direct download link extractions (e.g. MediaFire).
pub async fn resolve_url_async(raw_url: &str) -> Option<String> {
    if let Some(direct) = resolve_url(raw_url) {
        return Some(direct);
    }

    let parsed = Url::parse(raw_url).ok()?;
    let host = parsed.host_str()?.to_lowercase();

    // MediaFire direct download resolver
    if host == "mediafire.com" || host == "www.mediafire.com" {
        if let Ok(client) = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            if let Ok(resp) = client.get(raw_url).send().await {
                if resp.status().is_success() {
                    if let Ok(html) = resp.text().await {
                        if let Ok(re) = regex::Regex::new(r#"id=["']downloadButton["'][^>]*href=["'](https?://[^"']+)["']"#) {
                            if let Some(caps) = re.captures(&html) {
                                if let Some(m) = caps.get(1) {
                                    return Some(m.as_str().to_string());
                                }
                            }
                        }
                        if let Ok(re_cdn) = regex::Regex::new(r#"href=["'](https?://download[0-9]*\.mediafire\.com/[^"']+)["']"#) {
                            if let Some(caps) = re_cdn.captures(&html) {
                                if let Some(m) = caps.get(1) {
                                    return Some(m.as_str().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Helper to extract Google Drive file ID from path or query parameter.
fn extract_google_file_id(url: &Url) -> Option<String> {
    let path = url.path();
    for prefix in &[
        "/file/d/",
        "/document/d/",
        "/spreadsheets/d/",
        "/presentation/d/",
    ] {
        if let Some(rest) = path.strip_prefix(prefix) {
            let id = rest.split('/').next().unwrap_or("");
            if is_valid_google_id(id) {
                return Some(id.to_string());
            }
        }
    }

    // Fallback: check "id" query parameter
    for (k, v) in url.query_pairs() {
        if k == "id" && is_valid_google_id(&v) {
            return Some(v.into_owned());
        }
    }

    None
}

fn is_valid_google_id(id: &str) -> bool {
    id.len() >= 10
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_google_drive() {
        let input = "https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J-xyz/view?usp=sharing";
        let resolved = resolve_url(input).expect("should resolve google drive");
        assert_eq!(
            resolved,
            "https://drive.usercontent.google.com/download?id=1A2B3C4D5E6F7G8H9I0J-xyz&export=download&confirm=t"
        );

        let input_query = "https://drive.google.com/open?id=1A2B3C4D5E6F7G8H9I0J-xyz";
        let resolved_query = resolve_url(input_query).expect("should resolve google drive query");
        assert_eq!(
            resolved_query,
            "https://drive.usercontent.google.com/download?id=1A2B3C4D5E6F7G8H9I0J-xyz&export=download&confirm=t"
        );
    }

    #[test]
    fn test_google_docs_sheets_slides() {
        assert_eq!(
            resolve_url("https://docs.google.com/document/d/1234567890abcdef/edit").unwrap(),
            "https://docs.google.com/document/d/1234567890abcdef/export?format=docx"
        );
        assert_eq!(
            resolve_url("https://docs.google.com/spreadsheets/d/1234567890abcdef/edit#gid=0").unwrap(),
            "https://docs.google.com/spreadsheets/d/1234567890abcdef/export?format=xlsx"
        );
        assert_eq!(
            resolve_url("https://docs.google.com/presentation/d/1234567890abcdef/edit").unwrap(),
            "https://docs.google.com/presentation/d/1234567890abcdef/export/pptx"
        );
    }

    #[test]
    fn test_dropbox() {
        let input = "https://www.dropbox.com/s/abcdef123456789/my_archive.zip?dl=0";
        let resolved = resolve_url(input).expect("should resolve dropbox");
        assert!(resolved.contains("dl=1"));
        assert!(!resolved.contains("dl=0"));
    }

    #[test]
    fn test_pixeldrain() {
        let input = "https://pixeldrain.com/u/abc12345";
        let resolved = resolve_url(input).expect("should resolve pixeldrain");
        assert_eq!(resolved, "https://pixeldrain.com/api/file/abc12345?download");

        let input_file = "https://pixeldrain.com/file/xyz98765";
        let resolved_file = resolve_url(input_file).expect("should resolve pixeldrain file");
        assert_eq!(resolved_file, "https://pixeldrain.com/api/file/xyz98765?download");
    }

    #[test]
    fn test_onedrive() {
        let input = "https://1drv.ms/u/s!Anb123456789";
        let resolved = resolve_url(input).expect("should resolve onedrive");
        assert!(resolved.contains("download=1"));
    }

    #[test]
    fn test_vikingfile() {
        let input = "https://vik1ngfile.site/file/123456";
        let resolved = resolve_url(input).expect("should resolve vikingfile");
        assert_eq!(resolved, "https://vikingfile.com/file/123456");
    }

    #[test]
    fn test_huggingface() {
        let input = "https://huggingface.co/bert-base-uncased/blob/main/pytorch_model.bin";
        let resolved = resolve_url(input).expect("should resolve huggingface");
        assert_eq!(
            resolved,
            "https://huggingface.co/bert-base-uncased/resolve/main/pytorch_model.bin?download=true"
        );
    }

    #[test]
    fn test_github() {
        let input = "https://github.com/torvalds/linux/blob/master/README";
        let resolved = resolve_url(input).expect("should resolve github blob");
        assert_eq!(
            resolved,
            "https://raw.githubusercontent.com/torvalds/linux/master/README"
        );
    }

    #[test]
    fn test_gitlab() {
        let input = "https://gitlab.com/user/project/-/blob/main/config.yml";
        let resolved = resolve_url(input).expect("should resolve gitlab blob");
        assert_eq!(
            resolved,
            "https://gitlab.com/user/project/-/raw/main/config.yml"
        );
    }

    #[test]
    fn test_pastebin() {
        let input = "https://pastebin.com/d0wnl0ad";
        let resolved = resolve_url(input).expect("should resolve pastebin");
        assert_eq!(resolved, "https://pastebin.com/raw/d0wnl0ad");
    }

    #[test]
    fn test_gist() {
        let input = "https://gist.github.com/torvalds/123456789";
        let resolved = resolve_url(input).expect("should resolve gist");
        assert_eq!(
            resolved,
            "https://gist.githubusercontent.com/torvalds/123456789/raw"
        );
    }

    #[test]
    fn test_buzzheavier() {
        let input = "https://buzzheavier.com/f/abc123xyz";
        let resolved = resolve_url(input).expect("should resolve buzzheavier");
        assert_eq!(resolved, "https://buzzheavier.com/abc123xyz");
    }

    #[test]
    fn test_non_matching_url() {
        let input = "https://example.com/file.zip";
        assert_eq!(resolve_url(input), None);
    }
}
