First start of ZeluxDL
=====================
ZeluxDL isn't notarized by Apple (that needs a paid developer account), so macOS may block it
the first time. Allow it once: in Terminal run

    xattr -dr com.apple.quarantine /Applications/ZeluxDL.app

or open ZeluxDL, then System Settings -> Privacy & Security -> "Open Anyway".

ZeluxDL browser extension
========================

Download the matching Chromium or Firefox extension archive from the ZeluxDL GitHub Releases page:

    https://github.com/SMOKEx2/Zelux-DL/releases/latest

1. Extract the archive and load its folder from the browser's extensions page
   (Developer mode -> Load unpacked for Chromium; about:debugging for Firefox).
2. Pin the ZeluxDL icon if desired. It should say "Connected".

ZeluxDL walks you through this on first start, and any time in Settings -> Browser
integration. If you replace the extension files during an update, reload the extension
from the browser's extensions page.

Firefox and Zen
1. Open about:debugging#/runtime/this-firefox
2. "Load Temporary Add-on..." -> pick manifest.json in the folder ZeluxDL shows in
   Settings -> Browser integration (~/Library/Application Support/ZeluxDL/extension/firefox).
   Firefox forgets temporary add-ons on restart.
