# Install ZeluxDL

Download ZeluxDL from the [latest GitHub Release](https://github.com/SMOKEx2/Zelux-DL/releases/latest). Release assets are versioned; choose an asset that matches your operating system and architecture. Each release includes `SHA256SUMS.txt` for integrity checks.

## Windows

- `ZeluxDL_<version>_x64-setup.exe` installs for the current user.
- `ZeluxDL_<version>_x64_en-US.msi` is the MSI installer.
- `ZeluxDL-<version>-windows-x64-portable.zip` runs without installation; extract it before launching `ZeluxDL.exe`.

Windows may show SmartScreen because the release is not signed with a paid code-signing certificate. Verify the checksum first; only continue if you trust the downloaded release.

## macOS and Linux

Use the matching `.dmg` for macOS or `.deb`, `.rpm`, or `.AppImage` for Linux if that asset is present in the release. Not every platform asset is necessarily published for every version. Follow the operating system's normal installer flow and verify against `SHA256SUMS.txt`.

## Browser extension

The browser extension is optional. Install ZeluxDL first, then follow the [browser integration guide](browser-extension.md) to load the matching release archive and connect it to the app.

## Updating and uninstalling

Install a newer release over the existing installation to keep your settings and download history. For a portable copy, back up its `data` directory before replacing files. Uninstall through Windows **Settings → Apps**, or use your operating system's package manager on macOS/Linux.
