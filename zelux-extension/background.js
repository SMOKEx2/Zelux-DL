chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "zelux-download",
    title: "Download with ZELUX-DL",
    contexts: ["link", "video", "audio"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "zelux-download") {
    const url = info.linkUrl || info.srcUrl;
    triggerZeluxProtocol(url, tab.id);
  }
});

function triggerZeluxProtocol(url, tabId) {
  // Inject a hidden iframe to trigger the custom protocol without opening a new tab
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (targetUrl) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = "zelux://" + targetUrl;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 2000);
    },
    args: [url]
  });
}
