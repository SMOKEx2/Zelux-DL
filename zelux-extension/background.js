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
    if (/set the ZELUX-DL executable path/i.test(error.message || '')) {
      chrome.action.setBadgeText({ text: 'SET' });
      chrome.action.setBadgeBackgroundColor({ color: '#8655e8' });
      chrome.action.setTitle({ title: 'Open ZELUX-DL Link Capture to configure its executable path.' });
      return;
    }
    console.error('[ZELUX-DL] Unable to open protocol:', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'download-progress') return false;
  if (message?.type !== 'launch-download') return false;
  launchDownload(message)
    .then((result) => sendResponse({ ok: true, ...result }))
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

function normalizeZeluxExePath(value) {
  const candidate = String(value || '').trim().replace(/^"(.*)"$/, '$1').replaceAll('/', '\\');
  return /^[a-z]:\\(?:[^<>:"|?*\u0000-\u001f\\]+\\)*zelux-dl\.exe$/i.test(candidate)
    ? candidate
    : '';
}

async function getConfiguredZeluxExePath() {
  const stored = await chrome.storage.local.get('zeluxExePath');
  const exePath = normalizeZeluxExePath(stored?.zeluxExePath);
  if (!exePath) throw new Error('Set the ZELUX-DL executable path in extension settings before using link capture.');
  return exePath;
}

function isFacebookImageUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase();
    if (!(host.startsWith('scontent.') && host.endsWith('.fbcdn.net')) && !host.endsWith('.fbsbx.com')) return false;
    if (!/\.(?:jpe?g|png|webp|gif)(?:$|\/)/i.test(parsed.pathname) && !/\/v\/t\d+\./i.test(parsed.pathname)) return false;
    const hints = `${parsed.searchParams.get('cstp') || ''} ${parsed.searchParams.get('ctp') || ''}`;
    for (const match of hints.matchAll(/(\d{1,5})x(\d{1,5})/g)) {
      if (Number(match[1]) < 200 || Number(match[2]) < 200) return false;
    }
    if (/\/v\/t39\.30808-1\//i.test(parsed.pathname) && !/\d{3,5}x\d{3,5}/.test(hints)) return false;
    parsed.hash = '';
    return parsed.href;
  } catch (_) { return false; }
}

function normalizeFacebookImageUrls(values) {
  const best = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const url = isFacebookImageUrl(value);
    if (!url) continue;
    const parsed = new URL(url);
    const hints = `${parsed.searchParams.get('cstp') || ''} ${parsed.searchParams.get('ctp') || ''}`;
    const score = [...hints.matchAll(/(\d{2,5})x(\d{2,5})/g)]
      .reduce((max, match) => Math.max(max, Number(match[1]) * Number(match[2])), 0);
    const key = `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
    if (!best.has(key) || score > best.get(key).score) best.set(key, { url, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 200).map(item => item.url);
}

function buildProtocolUrl(urls, cookieToken = '', exePath = '', imageUrls = []) {
  const query = new URLSearchParams({ urls: JSON.stringify(urls) });
  if (cookieToken) query.set('cookieToken', cookieToken);
  if (exePath) query.set('exePath', exePath);
  const safeImages = normalizeFacebookImageUrls(imageUrls);
  if (safeImages.length) query.set('imageUrls', JSON.stringify(safeImages));
  return `zelux://download?${query.toString()}`;
}

function isFacebookHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch (_) { return false; }
}

function isYouTubeHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch (_) { return false; }
}

function isYouTubeUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch (_) { return false; }
}

function createCookieToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function selectCookieFields(cookies, provider = 'facebook') {
  const allowedDomain = provider === 'youtube'
    ? domain => /^\.?([a-z0-9-]+\.)*youtube\.com$/i.test(domain)
    : domain => domain === 'facebook.com' || domain.endsWith('.facebook.com');
  return cookies
    .filter(cookie => allowedDomain(String(cookie.domain || '').toLowerCase()))
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

async function sendCookiesToLocalApp(token, cookies, provider = 'facebook') {
  let lastError = 'ZELUX-DL did not accept the temporary session.';
  const startedAt = Date.now();
  const deadline = startedAt + 30000;
  let attempt = 0;
  let lastProgressSecond = -5;
  let postStarted = false;
  while (Date.now() < deadline) {
    try {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (attempt === 0 || seconds >= lastProgressSecond + 5) {
        lastProgressSecond = seconds;
        reportDownloadProgress(attempt === 0
          ? 'ZELUX-DL opened. Waiting for its local bridge before sending anything…'
          : `Still waiting for the ZELUX-DL local bridge (${seconds}s / 30s)…`);
      }
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonce = [...nonceBytes].map(value => value.toString(16).padStart(2, '0')).join('');
      const tokenBytes = new Uint8Array(token.match(/.{2}/g).map(value => parseInt(value, 16)));
      const key = await crypto.subtle.importKey('raw', tokenBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expectedProofBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, nonceBytes));
      const expectedProof = [...expectedProofBytes].map(value => value.toString(16).padStart(2, '0')).join('');
      const challenge = await fetchLocalBridge(
        `http://127.0.0.1:47821/challenge?nonce=${nonce}`,
        { cache: 'no-store' },
        Math.min(3000, deadline - Date.now()),
      );
      if (!challenge.ok) {
        if (challenge.status === 404) {
          throw new Error('The app at 127.0.0.1:47821 has no cookie relay (HTTP 404). Restart ZELUX-DL 1.7.0 or newer. No cookies were sent.');
        }
        if (challenge.status === 403) {
          let bridgeError = null;
          try { bridgeError = await challenge.json(); } catch (_) { /* Older bridge builds may return an empty response. */ }
          const extensionVersion = chrome.runtime.getManifest().version;
          if (bridgeError?.code === 'extension_origin_not_allowed') {
            const appVersion = bridgeError.appVersion ? ` by ZELUX-DL ${bridgeError.appVersion}` : '';
            const origin = bridgeError.origin ? ` (browser origin: ${bridgeError.origin})` : '';
            throw new Error(`ZELUX-DL extension ${extensionVersion} was rejected${appVersion} because its browser origin is not allowed${origin}. Update/restart the app and reload the extension from the same release. No cookies were sent.`);
          }
          throw new Error(`The local cookie bridge returned HTTP 403 to ZELUX-DL extension ${extensionVersion}. This usually means the installed app is older than 1.7.1 and does not recognize this browser's extension origin. Update the app to 1.7.1 or newer, then reload this extension. No cookies were sent.`);
        }
        throw new Error(`The local ZELUX-DL identity check returned HTTP ${challenge.status}. No cookies were sent.`);
      }
      const challengeBody = await challenge.json();
      if (challengeBody?.proof !== expectedProof) {
        throw new Error('Another or outdated service answered on the local cookie port. ZELUX-DL identity verification failed; no cookies were sent.');
      }

      reportDownloadProgress(`ZELUX-DL identity verified. Sending the opted-in ${provider} session locally…`);
      postStarted = true;
      const response = await fetchLocalBridge('http://127.0.0.1:47821/cookies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Zelux-Token': token,
        },
        body: JSON.stringify({ provider, cookies }),
        cache: 'no-store',
      }, Math.min(3000, deadline - Date.now()));
      if (response.ok) return;
      lastError = `Local cookie bridge rejected the request (${response.status}).`;
      postStarted = false;
      throw new Error(`${lastError} No session was accepted.`);
    } catch (error) {
      if (/no cookies were sent|rejected the request/i.test(error.message)) throw error;
      if (postStarted) {
        throw new Error('ZELUX-DL verified its local identity, but the session-transfer response was interrupted. The session may have reached ZELUX-DL on this PC; check the app before retrying.');
      }
      lastError = error.name === 'AbortError'
        ? 'The local ZELUX-DL bridge did not respond in time.'
        : 'Could not connect to the local ZELUX-DL bridge.';
    }
    attempt += 1;
    await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`${lastError} No response after 30 seconds. Check that the configured ZELUX-DL.exe is version 1.7.0 or newer, that it opened, and that Brave allowed local-app access. No cookies were sent; try again after correcting this.`);
}

async function fetchLocalBridge(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function reportDownloadProgress(message) {
  try {
    const pending = chrome.runtime.sendMessage?.({ type: 'download-progress', message });
    if (pending?.catch) pending.catch(() => {});
  } catch (_) { /* The popup may have closed; the download must continue. */ }
}

async function launchDownload(message) {
  const values = message.urls || [message.url];
  const tabId = message.tabId;
  let cookieToken = '';
  let cookies = [];
  const cookieProvider = message.includeYouTubeCookies === true ? 'youtube'
    : message.includeFacebookCookies === true ? 'facebook' : '';
  const includeCookies = Boolean(cookieProvider);
  const protocolAlreadyLaunched = message.protocolAlreadyLaunched === true;
  try {
    const exePath = await getConfiguredZeluxExePath();
    if (message.includeYouTubeCookies === true && message.includeFacebookCookies === true) {
      throw new Error('Choose only one temporary browser session per download.');
    }
    const tab = includeCookies && Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : null;

    if (includeCookies) {
      const isYouTube = cookieProvider === 'youtube';
      const providerLabel = isYouTube ? 'YouTube' : 'Facebook';
      reportDownloadProgress(`Reading the ${providerLabel} session you opted to share, locally in Brave…`);
      const urls = normalizeUrls(values);
      const validTab = isYouTube ? isYouTubeHost(tab?.url || '') : isFacebookHost(tab?.url || '');
      const validUrls = isYouTube ? urls.every(isYouTubeUrl) : urls.every(isFacebookHost);
      if (!tab?.url || !validTab || !urls.length || !validUrls) {
        throw new Error(`Temporary login cookies are available only for ${providerLabel} links opened from a ${providerLabel} tab.`);
      }
      const cookieQuery = isYouTube ? { url: 'https://www.youtube.com/' } : { url: tab.url };
      cookies = selectCookieFields(await chrome.cookies.getAll(cookieQuery), cookieProvider);
      if (!cookies.length) throw new Error(`No ${providerLabel} cookies found. Sign in to ${providerLabel} and retry.`);
      if (protocolAlreadyLaunched) {
        cookieToken = String(message.cookieToken || '');
        if (!/^[a-f0-9]{64}$/i.test(cookieToken)) throw new Error('The direct ZELUX-DL launch token is invalid. No cookies were sent.');
      } else {
        cookieToken = createCookieToken();
      }
    }

    let count;
    if (protocolAlreadyLaunched) {
      count = normalizeUrls(values).length;
      if (!includeCookies || !cookieToken || !count || count > 200 || !Number.isInteger(tabId)) {
        throw new Error('The direct ZELUX-DL launch request is invalid. No cookies were sent.');
      }
      reportDownloadProgress('The ZELUX-DL launch was requested. Waiting for its identity-verified local bridge…');
    } else {
      if (cookieToken) reportDownloadProgress('Opening ZELUX-DL and connecting to its local bridge…');
      count = await triggerZeluxProtocol(values, tabId, cookieToken, exePath, message.imageUrls);
    }
    if (cookieToken) await sendCookiesToLocalApp(cookieToken, cookies, cookieProvider);
    return { count, usedTemporaryCookies: Boolean(cookieToken) };
  } finally {
    cookies.length = 0;
    if (includeCookies) {
      const origins = cookieProvider === 'youtube'
        ? ['https://youtube.com/*', 'https://*.youtube.com/*', 'http://127.0.0.1/*']
        : ['https://facebook.com/*', 'https://*.facebook.com/*', 'http://127.0.0.1/*'];
      try {
        await chrome.permissions.remove({
          permissions: ['cookies'],
          origins,
        });
      } catch (_) { /* The browser may already have revoked the optional permissions. */ }
    }
  }
}

async function triggerZeluxProtocol(values, tabId, cookieToken = '', configuredExePath = '', imageUrls = []) {
  const urls = normalizeUrls(values);
  if (!urls.length) throw new Error('No valid HTTP or HTTPS URLs');
  if (urls.length > 200) throw new Error('A batch can contain up to 200 URLs');
  if (!Number.isInteger(tabId)) throw new Error('No active browser tab');

  const exePath = configuredExePath || await getConfiguredZeluxExePath();
  const protocolUrl = buildProtocolUrl(urls, cookieToken, exePath, imageUrls);
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
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({ title: 'ZELUX-DL Link Capture' });
  return urls.length;
}
