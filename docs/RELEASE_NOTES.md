# ZeluxDL 2.0.6

## What's new

- Send a YouTube playlist URL from the browser extension to the app's audio download picker.
- Limit YouTube Mix downloads to 200 tracks by default, configurable below Audio format. Creator playlists download all selected tracks without that limit.
- Save each playlist in a separate folder named after the playlist or first track, with a short playlist identifier and one completion notice for the group.
- Show gallery-dl tool status directly below ffmpeg in Video & streams settings.
- Start playlists with three concurrent downloads by default, configurable from one to ten in Video & streams settings. The same limit protects bulk Resume; the optional sequential mode still runs one track at a time.
- Store new accelerated media working files in the app's video cache instead of creating `.prism-*` folders alongside downloads. Existing resumable work keeps its checkpoint location until it finishes.

# ZeluxDL 2.0.5

## What's new

- Download images and videos from individual Facebook, Instagram, X and TikTok posts. Optional browser-session cookies are kept in memory for the selected downloads.
- Multiple files from a post use a dated, post-specific folder and a single completion notice. Single images go directly to the download folder.
- Social-media filenames include a source abbreviation and post identifier. Identical downloaded files are skipped, with an existing-file notification.
- Review duplicate downloads, select or clear multiple rows, and preview completed images in a translucent full-window viewer.
- Restore completed-video thumbnails and duration labels, and improve progress, selection and details-panel animations.
- Adapt the toolbar at narrow window widths with an overflow menu while keeping the window controls visible.

## Compatibility

Photo-post extraction downloads a pinned, SHA-256-verified gallery-dl executable on first use. Native extractor builds are available for Windows x64/x86, Linux x64 and Intel macOS. Other architectures retain yt-dlp video extraction; photo-post extraction is not available there yet. Private posts may require the optional signed-in browser session.

# ZeluxDL 2.0.4

## Fixed

- Keep the bundled browser extension version in sync with the app so browser integration no longer reports the shipped extension as outdated.

# ZeluxDL 2.0.3

This transition release enables verified in-app updates. Existing installations must install this release once from GitHub because the previous updater signing key was unavailable; later signed releases can be installed from within ZeluxDL.

## What's new

- Turbo Multi-Thread Booster now has integration coverage that verifies it raises the live connection target on a healthy transfer and respects the disabled setting.
- Updated ZeluxDL's install and browser integration guides to match the actual release assets and supported manual extension installation flow.
- Fixed macOS release packaging to use the ZeluxDL app bundle name.
- The About page now identifies the upstream Prism Download Manager as the source project; the rest of the product is presented as ZeluxDL.
- All release platforms now require signed updater bundles; release publishing fails rather than silently omitting the update manifest or shipping an incomplete manifest.
- The updater requires a signed version field and verifies every platform bundle against the configured ZeluxDL signing key.

## Notes

Browser integration is distributed in the GitHub Release archives. It is not currently listed in the Chrome Web Store or Firefox Add-ons. See the [installation guide](guide/installation.md) and [browser integration guide](guide/browser-extension.md).

## Earlier project history

Release notes for the upstream Prism Download Manager releases through v1.1.7 are preserved in the [upstream project history](https://github.com/FortoGraphy/prism-download-manager/blob/main/docs/RELEASE_NOTES.md). ZeluxDL's own release notes continue here from v2.0.3.
