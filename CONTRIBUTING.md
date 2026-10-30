# Contributing to ZeluxDL

Thanks for helping make ZeluxDL better! Bug reports, ideas, translations, docs and code are all
welcome.

## Ways to help

* ⭐ Star the repo and tell people about it — it genuinely helps.
* 🐞 [Report bugs](https://github.com/SMOKEx2/Zelux-DL/issues/new/choose) —
  Settings → Advanced → **Export diagnostics** gives us logs without anything private.
* 💡 Suggest features in [Discussions](https://github.com/SMOKEx2/Zelux-DL/discussions).
* 🧑‍💻 Send a pull request (see below).

## Development setup

Requirements and full build instructions: [BUILD.md](BUILD.md) (Windows, Linux) and
[docs/BUILD_MACOS.md](docs/BUILD_MACOS.md).

```bash
npm ci --prefix app && npm ci --prefix extension
cd app && npm run tauri:dev       # the app with hot reload
npm run dev                       # UI only, in a normal browser, with a demo backend
```

## Project map

| Path | What lives there |
|---|---|
| `crates/prism-engine` | Download engine: segmented HTTP/FTP, HLS/DASH, resume, speed limiter |
| `crates/prism-core` | App logic: download manager, SQLite, queues, scheduler, grabber, browser IPC |
| `crates/prism-video` | yt-dlp / ffmpeg / deno management, quality choices, muxing |
| `crates/prism-torrent` | BitTorrent / magnet support |
| `crates/prism-native-host` | Native messaging host (browser ↔ app) and browser registration |
| `crates/prism-testserver` | Configurable local HTTP server for tests and benchmarks |
| `app/` | React UI (`src/`) and the Tauri shell (`src-tauri/`) |
| `extension/` | Browser extension (Chromium + Firefox builds) |
| `site/` | The project website (GitHub Pages) |

Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md) · Design system:
[docs/design-system.md](docs/design-system.md).

## Before you open a PR

```bash
cargo test --workspace --exclude zeluxdl-app
cargo clippy --workspace --all-targets -- -D warnings
npm test --prefix app && npm run typecheck --prefix app
npm test --prefix extension && npm run typecheck --prefix extension
```

* Keep changes focused; one topic per PR.
* Match the surrounding code style (rustfmt / the existing TS style).
* UI changes: include before/after screenshots in dark and light themes.
* Engine changes: add a test against `prism-testserver` (throttling, drops, limits, …).

## Code of conduct

Be kind and constructive. Harassment or discrimination of any kind is not tolerated.

By contributing you agree that your contributions are licensed under the MIT License.
