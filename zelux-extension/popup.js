document.addEventListener('DOMContentLoaded', async () => {
  const input = document.getElementById('urlInput');
  const sendButton = document.getElementById('sendBtn');
  const scanButton = document.getElementById('scanBtn');
  const linkCount = document.getElementById('linkCount');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const pageTitle = document.getElementById('page-title');
  const pageHost = document.getElementById('page-host');
  const sessionControl = document.getElementById('facebookSessionControl');
  const includeFacebookCookies = document.getElementById('includeFacebookCookies');
  const captureView = document.getElementById('captureView');
  const settingsView = document.getElementById('settingsView');
  const settingsToggle = document.getElementById('settingsToggle');
  const exePathInput = document.getElementById('exePathInput');
  const saveExePathButton = document.getElementById('saveExePathBtn');
  const savedPath = document.getElementById('savedPath');
  const settingsStatus = document.getElementById('settingsStatus');
  const setupNotice = document.getElementById('setupNotice');
  document.querySelector('.version').textContent = `v${chrome.runtime.getManifest().version}`;

  let activeTab = null;
  let configuredExePath = '';
  let cookiePermissionGranted = false;
  const facebookPermission = {
    permissions: ['cookies'],
    origins: ['https://facebook.com/*', 'https://*.facebook.com/*', 'http://127.0.0.1/*'],
  };

  function normalizeZeluxExePath(value) {
    const candidate = String(value || '').trim().replace(/^"(.*)"$/, '$1').replaceAll('/', '\\');
    return /^[a-z]:\\(?:[^<>:"|?*\u0000-\u001f\\]+\\)*zelux-dl\.exe$/i.test(candidate)
      ? candidate
      : '';
  }

  function extractUrls(value) {
    const matches = String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    return [...new Set(matches.map(url => url.replace(/[),;]+$/g, '')).filter(isHttpUrl))];
  }

  function isHttpUrl(value) {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch (_) { return false; }
  }

  function isFacebookUrl(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === 'facebook.com' || host.endsWith('.facebook.com');
    } catch (_) { return false; }
  }

  function updateSessionOption() {
    const urls = extractUrls(input.value);
    const onFacebook = isFacebookUrl(activeTab?.url || '');
    const onlyFacebookLinks = urls.length > 0 && urls.every(isFacebookUrl);
    sessionControl.hidden = !(onFacebook && onlyFacebookLinks);
    if (sessionControl.hidden && includeFacebookCookies.checked) {
      includeFacebookCookies.checked = false;
      cookiePermissionGranted = false;
      chrome.permissions.remove(facebookPermission).catch(() => {});
    }
  }

  function renderCount() {
    const count = extractUrls(input.value).length;
    linkCount.textContent = `${count} ${count === 1 ? 'link' : 'links'}`;
    sendButton.disabled = count === 0 || !configuredExePath;
  }

  function renderConfiguration() {
    setupNotice.hidden = Boolean(configuredExePath);
    scanButton.disabled = !configuredExePath || !Number.isInteger(activeTab?.id);
    if (configuredExePath) {
      savedPath.hidden = false;
      savedPath.innerHTML = '';
      const label = document.createElement('span');
      label.textContent = 'บันทึกแล้ว: ';
      const value = document.createElement('code');
      value.textContent = configuredExePath;
      savedPath.append(label, value);
      if (settingsStatus.dataset.kind !== 'success') setSettingsStatus('พร้อมส่งลิงก์ไปยัง ZELUX-DL บนเครื่องนี้', 'success');
    } else {
      savedPath.hidden = true;
      if (!settingsStatus.textContent) setSettingsStatus('ยังไม่ได้ตั้งค่า กรุณาระบุพาธก่อนใช้งาน', 'error');
    }
    renderCount();
  }

  function setStatus(message, kind = 'idle') {
    statusText.textContent = message;
    status.dataset.kind = kind;
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'download-progress' && typeof message.message === 'string') {
      setStatus(message.message, 'busy');
    }
  });

  function setSettingsStatus(message, kind = 'idle') {
    settingsStatus.textContent = message;
    settingsStatus.dataset.kind = kind;
  }

  function showSettings(show) {
    captureView.hidden = show;
    settingsView.hidden = !show;
    settingsToggle.setAttribute('aria-expanded', String(show));
    settingsToggle.setAttribute('aria-label', show ? 'Close extension settings' : 'Open extension settings');
    if (show) exePathInput.focus();
  }

  try {
    const stored = await new Promise(resolve => chrome.storage.local.get('zeluxExePath', resolve));
    configuredExePath = normalizeZeluxExePath(stored?.zeluxExePath);
    exePathInput.value = configuredExePath || String(stored?.zeluxExePath || '');
  } catch (_) {
    setSettingsStatus('อ่านการตั้งค่าไม่ได้ ลองปิดแล้วเปิด Extension ใหม่', 'error');
  }

  if (!configuredExePath) setStatus('ต้องตั้งค่าพาธ ZELUX-DL.exe ก่อน จึงจะส่งลิงก์ได้', 'error');
  renderConfiguration();

  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.url && isHttpUrl(activeTab.url)) {
      input.value = activeTab.url;
      pageTitle.textContent = activeTab.title || new URL(activeTab.url).hostname;
      pageHost.textContent = new URL(activeTab.url).hostname;
    } else {
      pageTitle.textContent = 'This page cannot be scanned';
      pageHost.textContent = 'Open a website to capture links';
      scanButton.disabled = true;
    }
  } catch (_) {
    pageTitle.textContent = 'Browser tab unavailable';
    pageHost.textContent = 'Paste links below to continue';
    scanButton.disabled = true;
  }
  scanButton.disabled = !configuredExePath || !Number.isInteger(activeTab?.id);
  renderCount();
  updateSessionOption();

  settingsToggle.addEventListener('click', () => showSettings(settingsView.hidden));
  document.getElementById('openSettingsBtn').addEventListener('click', () => showSettings(true));
  document.getElementById('backToCaptureBtn').addEventListener('click', () => showSettings(false));
  saveExePathButton.addEventListener('click', () => {
    const exePath = normalizeZeluxExePath(exePathInput.value);
    if (!exePath) {
      setSettingsStatus('พาธไม่ถูกต้อง ต้องเป็นพาธ Windows แบบเต็มและลงท้ายด้วย ZELUX-DL.exe', 'error');
      exePathInput.focus();
      return;
    }
    saveExePathButton.disabled = true;
    chrome.storage.local.set({ zeluxExePath: exePath }, () => {
      const storageError = chrome.runtime.lastError;
      saveExePathButton.disabled = false;
      if (storageError) {
        setSettingsStatus(`บันทึกไม่สำเร็จ: ${storageError.message}`, 'error');
        return;
      }
      configuredExePath = exePath;
      exePathInput.value = exePath;
      setSettingsStatus('บันทึกพาธแล้ว Extension พร้อมใช้งาน', 'success');
      renderConfiguration();
    });
  });
  exePathInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveExePathButton.click();
  });

  if (new URLSearchParams(location.search).get('settings') === '1') showSettings(true);

  includeFacebookCookies.addEventListener('change', async () => {
    if (!includeFacebookCookies.checked) {
      cookiePermissionGranted = false;
      chrome.permissions.remove(facebookPermission).catch(() => {});
      setStatus('Temporary Facebook session is off. No cookies will be sent.', 'idle');
      return;
    }
    if (!isFacebookUrl(activeTab?.url || '') || !extractUrls(input.value).every(isFacebookUrl)) {
      includeFacebookCookies.checked = false;
      setStatus('Open Facebook and use only Facebook links for temporary session mode.', 'error');
      return;
    }
    includeFacebookCookies.disabled = true;
    setStatus('Approve Brave’s one-time Facebook and local-app permission prompt…', 'busy');
    try {
      cookiePermissionGranted = await chrome.permissions.request(facebookPermission);
      if (!cookiePermissionGranted) throw new Error('Permission was not granted. No Facebook cookies were read.');
      setStatus('Permission approved. Click Send to open ZELUX-DL and continue.', 'success');
    } catch (error) {
      cookiePermissionGranted = false;
      includeFacebookCookies.checked = false;
      chrome.permissions.remove(facebookPermission).catch(() => {});
      setStatus(error.message || 'Permission was not granted. No Facebook cookies were read.', 'error');
    } finally {
      includeFacebookCookies.disabled = false;
    }
  });

  input.addEventListener('input', () => {
    renderCount();
    updateSessionOption();
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !sendButton.disabled) sendLinks();
  });

  scanButton.addEventListener('click', async () => {
    if (!configuredExePath) {
      setStatus('ต้องระบุพาธ ZELUX-DL.exe ในการตั้งค่าก่อนใช้งาน', 'error');
      showSettings(true);
      return;
    }
    if (!Number.isInteger(activeTab?.id)) return;
    scanButton.disabled = true;
    setStatus('Scanning links visible on this page…', 'busy');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'scan-page', tabId: activeTab.id });
      if (!result?.ok) throw new Error(result?.error || 'The page could not be scanned.');
      const combined = extractUrls(`${input.value}\n${(result.urls || []).join('\n')}`);
      input.value = combined.join('\n');
      renderCount();
      setStatus(result.urls?.length ? `Added ${result.urls.length} page link${result.urls.length === 1 ? '' : 's'}. Review the list before sending.` : 'No additional links found. The current page URL is still in the list.', 'success');
    } catch (error) {
      setStatus(error.message || 'Could not scan this page. You can paste links manually.', 'error');
    } finally {
      scanButton.disabled = !configuredExePath || !Number.isInteger(activeTab?.id);
    }
  });

  async function sendLinks() {
    if (!configuredExePath) {
      setStatus('ต้องระบุพาธ ZELUX-DL.exe ในการตั้งค่าก่อนใช้งาน', 'error');
      showSettings(true);
      return;
    }
    const urls = extractUrls(input.value);
    if (!urls.length) {
      setStatus('Paste at least one valid HTTP or HTTPS link.', 'error');
      return;
    }
    sendButton.disabled = true;
    scanButton.disabled = true;
    const useCookies = includeFacebookCookies.checked;
    setStatus(useCookies
      ? 'Opening ZELUX-DL directly. The opted-in session will be sent only after its identity is verified…'
      : `Handing ${urls.length} link${urls.length === 1 ? '' : 's'} to Windows…`, 'busy');
    try {
      let resultPromise;
      if (useCookies) {
        if (!urls.every(isFacebookUrl) || !isFacebookUrl(activeTab?.url || '')) {
          throw new Error('Open Facebook and use only Facebook links for temporary session mode.');
        }
        if (!Number.isInteger(activeTab?.id)) throw new Error('No active Facebook tab. Reopen the extension on Facebook and try again.');
        if (urls.length > 200) throw new Error('A batch can contain up to 200 URLs.');
        if (!cookiePermissionGranted) throw new Error('First enable the Facebook session option and approve Brave’s permission prompt. No cookies were read.');
        const cookieToken = createCookieToken();
        const protocolUrl = buildProtocolUrl(urls, cookieToken, configuredExePath);
        if (protocolUrl.length > 30000) throw new Error('The URL list is too long to open directly. Send a smaller batch.');
        resultPromise = chrome.runtime.sendMessage({
          type: 'launch-download',
          urls,
          tabId: activeTab?.id,
          includeFacebookCookies: true,
          cookieToken,
          protocolAlreadyLaunched: true,
        });
        launchProtocolFromPopup(protocolUrl);
      } else {
        resultPromise = chrome.runtime.sendMessage({
          type: 'launch-download',
          urls,
          tabId: activeTab?.id,
          includeFacebookCookies: false,
        });
      }
      const result = await resultPromise;
      if (!result?.ok) throw new Error(result?.error || 'Could not hand links to ZELUX-DL.');
      setStatus(result.usedTemporaryCookies
        ? `Sent a temporary Facebook session locally for ${result.count} link${result.count === 1 ? '' : 's'}. ZELUX-DL removes its temporary file after the job.`
        : `Requested Windows to open ${result.count} link${result.count === 1 ? '' : 's'} with ZELUX-DL. If nothing opens, check protocol registration.`, 'success');
    } catch (error) {
      const detail = error.message || 'Could not send the link to ZELUX-DL.';
      setStatus(/no cookies were sent|cookie bridge|identity verification|local ZELUX-DL/i.test(detail)
        ? detail
        : `${detail} Check that ZELUX-DL is installed and its zelux:// handler is registered.`, 'error');
    } finally {
      if (useCookies) {
        cookiePermissionGranted = false;
        includeFacebookCookies.checked = false;
      }
      scanButton.disabled = !configuredExePath || !Number.isInteger(activeTab?.id);
      renderCount();
    }
  }

  function createCookieToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function buildProtocolUrl(urls, cookieToken, exePath) {
    const query = new URLSearchParams({ urls: JSON.stringify(urls), cookieToken, exePath });
    return `zelux://download?${query.toString()}`;
  }

  function launchProtocolFromPopup(protocolUrl) {
    const anchor = document.createElement('a');
    anchor.href = protocolUrl;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  sendButton.addEventListener('click', sendLinks);
});
