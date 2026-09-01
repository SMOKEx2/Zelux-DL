const MENU_ID = 'zelux-download';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Download with ZELUX-DL',
    contexts: ['link', 'video', 'audio']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl || info.srcUrl;
  triggerZeluxProtocol([url], tab?.id).catch((error) => {
    console.error('[ZELUX-DL] Unable to open protocol:', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'launch-download') return false;
  triggerZeluxProtocol(message.urls || [message.url], message.tabId)
    .then((count) => sendResponse({ ok: true, count }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

function normalizeUrls(values) {
  const urls = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const url = String(value || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function buildProtocolUrl(urls) {
  return `zelux://download?urls=${encodeURIComponent(JSON.stringify(urls))}`;
}

async function triggerZeluxProtocol(values, tabId) {
  const urls = normalizeUrls(values);
  if (!urls.length) throw new Error('No valid HTTP or HTTPS URLs');
  if (urls.length > 200) throw new Error('A batch can contain up to 200 URLs');
  if (!Number.isInteger(tabId)) throw new Error('No active browser tab');

  const protocolUrl = buildProtocolUrl(urls);
  if (protocolUrl.length > 30000) throw new Error('The URL list is too long; use a .txt batch file instead');
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (targetProtocolUrl) => {
      const iframe = document.createElement('iframe');
      iframe.hidden = true;
      iframe.src = targetProtocolUrl;
      (document.body || document.documentElement).appendChild(iframe);
      setTimeout(() => iframe.remove(), 3000);
    },
    args: [protocolUrl]
  });
  return urls.length;
}
