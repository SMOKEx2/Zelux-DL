# Building ZeluxDL (Windows & Linux)

macOS has its own guide: [`docs/BUILD_MACOS.md`](docs/BUILD_MACOS.md).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | stable ≥ 1.88 (tested 1.99) | `rustup default stable` |
| Node.js | 24 LTS (npm 11) | builds the UI and the extension |
| Windows | Visual Studio 2022 Build Tools with "Desktop development with C++", Windows 10/11 SDK | WebView2 runtime is preinstalled on Windows 10/11 |
| Linux (Debian/Ubuntu 22.04+) | `sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev patchelf rpm` | `rpm` only needed to build .rpm |
| Optional | `ffmpeg` on PATH | otherwise ZeluxDL downloads a verified build on first video download |

## One-time setup

```bash
git clone <repo> prism && cd prism
npm ci --prefix app
npm ci --prefix extension
```

## Development

```bash
# Terminal 1 – everything (sidecar + Vite + Tauri with hot reload)
cd app
npm run tauri:dev
```

The UI also runs in a normal browser with a built-in demo backend (`npm run dev` in `app/`,
then open http://localhost:1420) — handy for UI work without compiling Rust.

## Tests

```bash
cargo test --workspace --exclude zeluxdl-app      # engine, core, video, torrent, native host
cargo clippy --workspace --all-targets -- -D warnings
npm test --prefix app && npm run typecheck --prefix app
npm test --prefix extension && npm run typecheck --prefix extension
npm run e2e --prefix extension                    # browser ↔ native host ↔ app (Playwright)
```

## Release builds

```bash
npm run build --prefix extension      # extension/build/{chromium,firefox} + zips
cd app
npm run tauri:build                   # builds the native host sidecar, the UI and all bundles
```

Outputs (in `target/release/bundle/`):

| Platform | Artifacts |
|---|---|
| Windows | `nsis/ZeluxDL_<ver>_x64-setup.exe`, `msi/ZeluxDL_<ver>_x64_en-US.msi` |
| Linux | `deb/zeluxdl_<ver>_amd64.deb`, `rpm/zeluxdl-<ver>-1.x86_64.rpm`, `appimage/zeluxdl_<ver>_amd64.AppImage` |

Windows portable zip (after `tauri:build`):

```powershell
./scripts/make-portable.ps1          # -> packaging/out/ZeluxDL-<ver>-windows-x64-portable.zip
```

Building only some bundles: `npx tauri build --bundles nsis` (or `msi`, `deb`, `rpm`, `appimage`).

### Building Linux packages on Windows (WSL)

The Linux bundles were produced from WSL2 Ubuntu 22.04:

```bash
wsl -d Ubuntu-22.04
# inside WSL, on a Linux filesystem path (not /mnt/c, which is very slow):
git clone /mnt/c/path/to/prism ~/prism && cd ~/prism
curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y
# Node 24 via nvm or NodeSource, then the apt packages above
npm ci --prefix app && npm ci --prefix extension
npm run build --prefix extension && (cd app && npm run tauri:build)
```

## What the installers do

* **NSIS / MSI (Windows):** install per user (NSIS) or per machine (MSI), add Start-menu
  entries and an uninstaller, associate `.torrent` files, register the `magnet:` handler,
  and run `zeluxdl-native-host register` so Chrome, Edge, Brave, Opera, Vivaldi, Chromium
  and Firefox can reach the app. Uninstalling removes the registrations.
* **deb / rpm (Linux):** install the app and `/usr/bin/zeluxdl-native-host`, a
  `.desktop` entry, and system-wide native messaging manifests for Chrome, Chromium, Edge
  and Firefox (`packaging/linux/postinst.sh`). Brave, Vivaldi and Opera get per-user
  manifests written by the app on every start.
* **AppImage:** the app copies the host to `~/.local/share/zeluxdl/bin/` (the AppImage mount
  path changes every run) and registers per-user manifests.
* **Autostart** is a setting (off by default) handled by the app itself.

## Continuous integration

`.github/workflows/ci.yml` runs tests, clippy and type checks on Windows, Linux and macOS.
`.github/workflows/release.yml` builds all bundles (Windows x64, Linux x64, macOS arm64 and
x64) on tag push and uploads them as workflow artifacts.

## Browser extension

See [`extension/README.md`](extension/README.md). In short: load
`extension/build/chromium` unpacked in Chromium-based browsers (Developer mode), and
`extension/build/firefox/manifest.json` as a temporary add-on in Firefox (or sign the
generated zip on addons.mozilla.org as an unlisted add-on for a permanent install).
