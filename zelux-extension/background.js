const MENU_ID = 'zelux-download';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Download with ZELUX-DL',
      contexts: ['link', 'video', 'audio']
    });
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
  if (message?.type === 'scan-page') {
    scanPageLinks(message.tabId)
      .then((urls) => sendResponse({ ok: true, urls }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== 'launch-download') return false;
  launchDownload(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function scanPageLinks(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('No active browser tab.');
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const candidates = [];
      for (const anchor of document.querySelectorAll('a[href]')) {
        const raw = anchor.href;
        const label = (anchor.innerText || anchor.getAttribute('download') || anchor.title || '').trim();
        candidates.push({ url: raw, label });
      }
      for (const media of document.querySelectorAll('video[src], audio[src], video source[src], audio source[src]')) {
        candidates.push({ url: media.src, label: media.getAttribute('title') || media.getAttribute('aria-label') || media.tagName.toLowerCase() });
      }
      const found = [];
      const seen = new Set();
      for (const candidate of candidates) {
        try {
          const url = new URL(candidate.url, location.href);
          if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
          seen.add(url.href);
          found.push(url.href);
          if (found.length >= 200) break;
        } catch (_) { /* Ignore malformed or non-web URLs. */ }
      }
      return found;
    }
  });
  return injected?.[0]?.result || [];
}

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

function buildProtocolUrl(urls, cookieToken = '') {
  const query = new URLSearchParams({ urls: JSON.stringify(urls) });
  if (cookieToken) query.set('cookieToken', cookieToken);
  return `zelux://download?${query.toString()}`;
}

function isFacebookHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch (_) { return false; }
}

function createCookieToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function selectCookieFields(cookies) {
  return cookies
    .filter(cookie => cookie.domain === 'facebook.com' || String(cookie.domain || '').endsWith('.facebook.com'))
    .map(cookie => ({
      domain: cookie.domain,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
    }));
}

async function sendCookiesToLocalApp(token, cookies) {
  let lastError = 'ZELUX-DL did not accept the temporary session.';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonce = [...nonceBytes].map(value => value.toString(16).padStart(2, '0')).join('');
      const tokenBytes = new Uint8Array(token.match(/.{2}/g).map(value => parseInt(value, 16)));
      const key = await crypto.subtle.importKey('raw', tokenBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expectedProofBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, nonceBytes));
      const expectedProof = [...expectedProofBytes].map(value => value.toString(16).padStart(2, '0')).join('');
      const challenge = await fetch(`http://127.0.0.1:47821/challenge?nonce=${nonce}`, { cache: 'no-store' });
      if (!challenge.ok) {
        if (challenge.status === 404) {
          throw new Error('The app at 127.0.0.1:47821 has no cookie relay (HTTP 404). Restart ZELUX-DL 1.7.0 or newer. No cookies were sent.');
        }
        if (challenge.status === 403) {
          throw new Error('The local cookie bridge rejected this extension (HTTP 403). Reload the ZELUX-DL 2.4.0 extension and grant its local-app permission. No cookies were sent.');
        }
        throw new Error(`The local ZELUX-DL identity check returned HTTP ${challenge.status}. No cookies were sent.`);
      }
      const challengeBody = await challenge.json();
      if (challengeBody?.proof !== expectedProof) {
        throw new Error('Another or outdated service answered on the local cookie port. ZELUX-DL identity verification failed; no cookies were sent.');
      }

      const response = await fetch('http://127.0.0.1:47821/cookies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Zelux-Token': token,
        },
        body: JSON.stringify({ cookies }),
        cache: 'no-store',
      });
      if (response.ok) return;
      lastError = `Local cookie bridge rejected the request (${response.status}).`;
      if (response.status === 400 || response.status === 403 || response.status === 413) throw new Error(lastError);
    } catch (error) {
      if (/no cookies were sent|rejected the request/i.test(error.message)) throw error;
      lastError = 'Could not connect to the local ZELUX-DL bridge.';
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${lastError} Make sure ZELUX-DL opened, then try again.`);
}

async function launchDownload(message) {
  const values = message.urls || [message.url];
  const tabId = message.tabId;
  let cookieToken = '';
  let cookies = [];
  const includeCookies = message.includeFacebookCookies === true;
  try {
    const tab = includeCookies && Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : null;

    if (includeCookies) {
      const urls = normalizeUrls(values);
      if (!tab?.url || !isFacebookHost(tab.url) || !urls.length || urls.some(url => !isFacebookHost(url))) {
        throw new Error('Temporary login cookies are available only for Facebook links opened from a Facebook tab.');
      }
      cookies = selectCookieFields(await chrome.cookies.getAll({ url: tab.url }));
      if (!cookies.length) throw new Error('No Facebook cookies found in this browser tab. Sign in to Facebook and retry.');
      cookieToken = createCookieToken();
    }

    const count = await triggerZeluxProtocol(values, tabId, cookieToken);
    if (cookieToken) await sendCookiesToLocalApp(cookieToken, cookies);
    return { count, usedTemporaryCookies: Boolean(cookieToken) };
  } finally {
    cookies.length = 0;
    if (includeCookies) {
      try {
        await chrome.permissions.remove({
          permissions: ['cookies'],
          origins: ['https://facebook.com/*', 'https://*.facebook.com/*', 'http://127.0.0.1/*'],
        });
      } catch (_) { /* The browser may already have revoked the optional permissions. */ }
    }
  }
}

async function triggerZeluxProtocol(values, tabId, cookieToken = '') {
  const urls = normalizeUrls(values);
  if (!urls.length) throw new Error('No valid HTTP or HTTPS URLs');
  if (urls.length > 200) throw new Error('A batch can contain up to 200 URLs');
  if (!Number.isInteger(tabId)) throw new Error('No active browser tab');

  const protocolUrl = buildProtocolUrl(urls, cookieToken);
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
