# Building ZeluxDL on macOS

ZeluxDL is developed and tested primarily on Windows and Linux. The code base is fully
macOS-buildable — every OS-specific piece sits behind `#[cfg(target_os = "macos")]`
implementations — but it has **not been run on a Mac yet**. Follow these steps exactly and
report anything that differs.

## 1. Prerequisites (macOS 11 Big Sur or newer; Apple Silicon or Intel)

```bash
xcode-select --install                       # Command Line Tools (clang, codesign, notarytool)
curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # both, for a universal build
brew install node@24 ffmpeg                  # ffmpeg is optional but recommended
```

> ffmpeg: ZeluxDL uses a system ffmpeg on macOS (there is no official checksummed static
> macOS build to auto-download). Without it, video muxing falls back to yt-dlp-only paths
> and HLS/DASH downloads keep `.ts`/`.m4s` output.

## 2. Build

```bash
git clone <repo> prism && cd prism
npm ci --prefix app
npm ci --prefix extension
npm run build --prefix extension

cd app
# Native architecture (.app + .dmg):
npm run tauri:build
# Or a universal binary:
node ../scripts/build-sidecar.mjs --target aarch64-apple-darwin
node ../scripts/build-sidecar.mjs --target x86_64-apple-darwin
lipo -create -output src-tauri/binaries/zeluxdl-native-host-universal-apple-darwin \
  src-tauri/binaries/zeluxdl-native-host-aarch64-apple-darwin \
  src-tauri/binaries/zeluxdl-native-host-x86_64-apple-darwin
npx tauri build --target universal-apple-darwin
```

Artifacts: `target/<target>/release/bundle/macos/ZeluxDL.app` and the matching DMG in
`target/<target>/release/bundle/dmg/`.

## 3. What is macOS-specific (already implemented)

| Area | Implementation |
|---|---|
| App icon | `app/src-tauri/icons/icon.icns` (generated from `assets/brand/app-icon.svg`) |
| Tray | Template (monochrome) tray image `assets/brand/tray/tray-template.png`, menu-bar friendly |
| Window material | `window-vibrancy` `NSVisualEffectMaterial::UnderWindowBackground` (macOS 26 Liquid Glass is picked up automatically by the system material) |
| Power actions | `osascript` shut down, `pmset sleepnow`, `pmset displaysleepnow` (lock) |
| Keep awake while downloading | `caffeinate -i` child process |
| Autostart | LaunchAgent via `tauri-plugin-autostart` (`--background`) |
| Data directory | `~/Library/Application Support/ZeluxDL` |
| Native messaging | per-user manifests written by the app and by `zeluxdl-native-host register`: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, `.../Chromium/...`, `.../Microsoft Edge/...`, `.../BraveSoftware/Brave-Browser/...`, `.../Vivaldi/...`, `~/Library/Application Support/Mozilla/NativeMessagingHosts` (Opera reads the Chrome location) |
| Host path | the host binary lives inside the bundle: `ZeluxDL.app/Contents/MacOS/zeluxdl-native-host`; it starts the app in the background when it is not running |
| Entitlements | `packaging/macos/entitlements.plist` (hardened runtime, network client/server, user-selected + Downloads read/write). ZeluxDL is intentionally **not sandboxed**: the App Sandbox blocks native messaging hosts and arbitrary download folders. |
| Wake timers | not supported (`pmset schedule` needs admin) — schedules run when the Mac is awake |

## 4. First run checks

1. Open `ZeluxDL.app` (right-click → Open the first time if unsigned).
2. Settings → Browser integration → **Repair** — every installed browser should show
   "Registered".
3. Load the extension (Chrome: `chrome://extensions` → Developer mode → Load unpacked →
   `extension/build/chromium`; Firefox: `about:debugging` → Load Temporary Add-on).
4. Download a test file from the browser and confirm the "Download File" dialog appears.
5. Settings → Video & streams → **Check tools**: yt-dlp and deno should be downloaded
   automatically; ffmpeg should show "System".

## 5. Signing and notarization (optional, for running without Gatekeeper warnings)

You need an Apple Developer account and a "Developer ID Application" certificate in your
login keychain.

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"     # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID="TEAMID"
cd app && npx tauri build --target universal-apple-darwin
```

Tauri signs the app (hardened runtime + the entitlements file referenced in
`tauri.conf.json` → `bundle.macOS.entitlements`), signs the `externalBin` sidecar, submits
to `notarytool` and staples the ticket. Verify:

```bash
codesign --verify --deep --strict --verbose=2 "target/universal-apple-darwin/release/bundle/macos/ZeluxDL.app"
spctl --assess --type execute --verbose "target/universal-apple-darwin/release/bundle/macos/ZeluxDL.app"
xcrun stapler validate "target/universal-apple-darwin/release/bundle/dmg/"*.dmg
```

Notes:
* The native messaging host is a separate executable inside the bundle; it must be signed
  too (Tauri does this for `externalBin`). Browsers launch it directly.
* yt-dlp / deno downloaded at runtime land in `~/Library/Application Support/ZeluxDL/tools`
  and are executed as child processes; Gatekeeper does not quarantine files written by the
  app itself, so no extra steps are needed.

## 6. CI

`.github/workflows/release.yml` builds `aarch64-apple-darwin` and `x86_64-apple-darwin`
DMGs on Apple Silicon runners (`macos-15`; the Intel build is cross-compiled). This already
works: release builds produce ZeluxDL-named `.dmg` files for both architectures.

Without signing secrets the app gets an **ad-hoc signature** (`bundle.macOS.signingIdentity
= "-"`), which Apple Silicon requires to launch at all. Gatekeeper still asks on first launch:
right-click `ZeluxDL.app` → **Open** (or `xattr -dr com.apple.quarantine /Applications/ZeluxDL.app`).
Add the `APPLE_*` secrets to the repository to get Developer-ID-signed, notarized DMGs.
