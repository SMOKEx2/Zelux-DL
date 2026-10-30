# v2.0.5 release QC — 2026-10-31

## Scope

Reviewed the release diff across the desktop UI, Tauri command boundary, core download manager,
social-media extraction, browser extension, packaging, version metadata and public documentation.
Scanned candidate source files for common private-key/token patterns and oversized files.
Local build directories, development data and personal session notes are excluded from Git.

## Corrections made during QC

- Made conditional translation keys visible to the existing catalog checker.
- Scoped temporary social-session cookies to the original page host; added a regression test.
- Allowed the Tauri asset protocol for completed-image previews on non-Windows platforms.
- Kept yt-dlp video extraction available on architectures without a native gallery-dl build.
- Prevented ffprobe console flashes and terminated timed-out subprocesses.
- Corrected Linux native-host names/extension IDs and added a cross-component packaging test.
- Corrected build paths, extension ZIP names and the documented autostart default.
- Resolved Rust formatting and Clippy findings.

## Performance

- Duplicate checks reject different 64 KiB prefixes before reading complete same-sized files.
  Matching prefixes still require full SHA-256 equality; a regression test covers equal prefixes
  with different content later in the file.
- Completed-image thumbnails decode asynchronously and retain lazy loading.
- Progress-head movement uses a compositor transform rather than animating layout position.
- Row callbacks stay stable during selection changes, and added-row detection is memoized by
  list identity instead of rescanning all IDs during each viewport/layout update.
- Browser smoke checks cover 10,000 downloads and assert bounded mounted rows before/after scrolling.
- No new runtime package was introduced for these optimizations.

240 Hz is a target with a 4.17 ms frame budget, not an unconditional FPS guarantee.
Actual presentation rate requires compatible display hardware, WebView configuration and a
hardware capture; the headless preview checks do not establish a 240 FPS result.

## Verification commands

Local results: app tests 81/81; extension tests 72/72; Chromium native-messaging checks 15/15;
responsive/large-list checks 9/9; dev IPC tests 4/4; packaging/updater Python tests 4/4.
Clippy passed with warnings denied. Dependency audits reported zero vulnerabilities in the
app dependency tree and extension production dependencies.
The complete Rust workspace test command passed; the nine opt-in live-service tests remained ignored.

```text
cargo test -j 1 --workspace --exclude zeluxdl-app -- --test-threads=1
cargo clippy -j 1 --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
npm test --prefix app
npm run build --prefix app
npm run typecheck --prefix extension
npm test --prefix extension
npm run build --prefix extension
npm run e2e --prefix extension
node --test scripts/dev-ipc-bridge.test.mjs
python -m unittest discover -s tests -v
node scripts/release-ui-qc.mjs
npm audit --prefix app
npm audit --prefix extension --omit=dev
npm ci --dry-run --ignore-scripts --prefix app
npm ci --dry-run --ignore-scripts --prefix extension
git diff --check
```

The UI smoke script requires the Vite preview server on port 1420. It checks Thai/English
window controls and the overflow menu at 940/960/1180/1320 pixels. Browser-native messaging
was exercised with the current debug host and real headless Chromium (15 checks).

## Limits

The nine opt-in live video tests require external services and were left ignored by the normal
Rust suite. Browser-preview sizing checks do not simulate Windows' native Snap gestures.
Installer builds and platform-specific compilation are checked by GitHub CI/release workflows;
interactive macOS/Linux installer testing was not performed on this Windows machine.
The gallery-dl platform matrix is documented in RELEASE_NOTES.md.
