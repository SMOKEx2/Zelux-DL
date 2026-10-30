# ZeluxDL browser integration

The optional browser extension can hand supported downloads and media links to the ZeluxDL desktop app. The extension is distributed from the [ZeluxDL GitHub Releases](https://github.com/SMOKEx2/Zelux-DL/releases/latest); it is not currently listed in the Chrome Web Store or Firefox Add-ons.

## Install

1. Install and open ZeluxDL once so its native messaging host is registered.
2. Download `ZeluxDL-extension-chromium.zip` for Chrome, Edge, Brave, Opera, Vivaldi, or another Chromium browser, or `ZeluxDL-extension-firefox.zip` for Firefox-based browsers.
3. Extract the archive into a folder that you will keep in place.
4. Open the browser's extensions page. For Chromium, enable **Developer mode** and choose **Load unpacked**, then select the extracted folder. For Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `manifest.json` in the extracted folder. Firefox temporary add-ons may need to be loaded again after restarting the browser.
5. In ZeluxDL, open **Settings → Browser integration** and choose **Repair** if the extension does not connect. Reload the extension in the browser if you replaced its files during an update.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Extension reports **Not connected** | Start ZeluxDL, then use **Settings → Browser integration → Repair** and reload the extension. |
| Browser says the extension is already installed but it is an older copy | Remove the old copy, then load the folder from the current release again. |
| No media is detected | Open a page with playable media, reload the page after installing the extension, and check the extension's site access permissions. |
| Firefox extension disappears after restart | This is expected for a temporary add-on; load it again, or install a signed package if one is provided in a future release. |

## Privacy

The extension communicates with the desktop app through the browser's native messaging interface. It does not upload browsing data to ZeluxDL servers. If a download requires a logged-in session, session cookies are only shared when the user explicitly opts in for that transfer; use only content your account is permitted to access.
