Prism — portable edition
========================

1. Run ZeluxDL.exe. All settings, history and tools are kept in the "data" folder
   next to it (because portable.txt exists), so the folder can live on a USB drive.
2. Browser integration: Prism registers its native messaging host for the current
   Windows user on start. Then add the extension:
     Chrome / Edge / Brave / Opera / Vivaldi: from the Chrome Web Store (it updates
     by itself) - https://chromewebstore.google.com/detail/prism-download-manager/mmcdeiglkbfbicdjboocmhehodogilfl
     Firefox: about:debugging -> This Firefox -> Load Temporary Add-on ->
     extension\firefox\manifest.json
3. Settings -> Browser integration shows the status and repairs it in one click.

Requires the Microsoft Edge WebView2 runtime (preinstalled on Windows 10/11).
