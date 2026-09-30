document.addEventListener('DOMContentLoaded', async () => {
  const input = document.getElementById('urlInput');
  const sendButton = document.getElementById('sendBtn');
  const linkCount = document.getElementById('linkCount');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const pageTitle = document.getElementById('page-title');
  const pageHost = document.getElementById('page-host');
  const sessionControl = document.getElementById('facebookSessionControl');
  const includeFacebookCookies = document.getElementById('includeFacebookCookies');
  const youtubeSessionControl = document.getElementById('youtubeSessionControl');
  const includeYouTubeCookies = document.getElementById('includeYouTubeCookies');
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
  let capturedFacebookImageUrls = [];
  let facebookCookiePermissionGranted = false;
  let youtubeCookiePermissionGranted = false;
  const facebookPermission = {
    permissions: ['cookies'],
    origins: ['https://facebook.com/*', 'https://*.facebook.com/*', 'http://127.0.0.1/*'],
  };
  const youtubePermission = {
    permissions: ['cookies'],
    origins: ['https://youtube.com/*', 'https://*.youtube.com/*', 'http://127.0.0.1/*'],
  };

  function normalizeZeluxExePath(value) {
    const candidate = String(value || '').trim().replace(/^"(.*)"$/, '$1').replaceAll('/', '\\');
    return /^[a-z]:\\(?:[^<>:"|?*\u0000-\u001f\\]+\\)*zelux-dl\.exe$/i.test(candidate)
      ? candidate
      : '';
  }

  function extractUrls(value) {
    const sourceText = String(value || '')
      .replace(/https?\\:\/\//gi, url => url.replace('\\:', ':'))
      .replace(/&#(?:x0*d|0*13);/gi, '\n')
      .replace(/\\(?=\s*(?:\r?\n|$))/g, '')
      .replace(/\*\*/g, '');
    const matches = sourceText.match(/https?:\/\/[^\s<>"']+/gi) || [];
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

  function isYouTubeHost(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === 'youtube.com' || host.endsWith('.youtube.com');
    } catch (_) { return false; }
  }

  function isYouTubeUrl(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
    } catch (_) { return false; }
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
      parsed.hash = '';
      return parsed.href;
    } catch (_) { return false; }
  }

  async function captureFacebookPostImages(tabId) {
    if (!Number.isInteger(tabId) || !isFacebookUrl(activeTab?.url || '')) return [];
    try {
      const response = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Prefer the visible post viewer. Do not combine the whole page with
          // the dialog: that would bring avatars, recommendations and other
          // feed cards into the download set.
          const root = document.querySelector('[role="dialog"]')
            || document.querySelector('article')
            || document.querySelector('[data-pagelet*="FeedUnit"]')
            || document.querySelector('[role="main"]')
            || document;
          const candidates = [];
          const add = value => {
            if (!value) return;
            try {
              const parsed = new URL(value, location.href);
              const host = parsed.hostname.toLowerCase();
              if (!(host.startsWith('scontent.') && host.endsWith('.fbcdn.net')) && !host.endsWith('.fbsbx.com')) return;
              if (!/\.(?:jpe?g|png|webp|gif)(?:$|\/)/i.test(parsed.pathname) && !/\/v\/t\d+\./i.test(parsed.pathname)) return;
              const hints = `${parsed.searchParams.get('cstp') || ''} ${parsed.searchParams.get('ctp') || ''}`;
              for (const match of hints.matchAll(/(\d{1,5})x(\d{1,5})/g)) if (Number(match[1]) < 200 || Number(match[2]) < 200) return;
              parsed.hash = '';
              candidates.push(parsed.href);
            } catch (_) { /* Ignore malformed DOM attributes. */ }
          };
          const largestSrcset = value => String(value || '').split(',')
            .map(part => {
              const pieces = part.trim().split(/\s+/);
              const width = Number((pieces[1] || '').replace(/w$/i, '')) || 0;
              return { url: pieces[0], width };
            })
            .sort((a, b) => b.width - a.width)[0]?.url;
          for (const image of root.querySelectorAll?.('img') || []) {
            const rect = image.getBoundingClientRect?.();
            const width = Math.max(image.naturalWidth || 0, image.width || 0, rect?.width || 0);
            const height = Math.max(image.naturalHeight || 0, image.height || 0, rect?.height || 0);
            if (width < 200 || height < 200) continue;
            add(largestSrcset(image.getAttribute('srcset') || image.getAttribute('data-srcset')));
            add(image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-original'));
          }
          return [...new Set(candidates)];
        },
      });
      return [...new Set((response?.[0]?.result || []).map(isFacebookImageUrl).filter(Boolean))].slice(0, 200);
    } catch (_) {
      return [];
    }
  }

  function updateSessionOption() {
    const urls = extractUrls(input.value);
    const onFacebook = isFacebookUrl(activeTab?.url || '');
    const onlyFacebookLinks = urls.length > 0 && urls.every(isFacebookUrl);
    sessionControl.hidden = !(onFacebook && onlyFacebookLinks);
    if (sessionControl.hidden && includeFacebookCookies.checked) {
      includeFacebookCookies.checked = false;
      facebookCookiePermissionGranted = false;
      chrome.permissions.remove(facebookPermission).catch(() => {});
    }
    const onYouTube = isYouTubeHost(activeTab?.url || '');
    const onlyYouTubeLinks = urls.length > 0 && urls.every(isYouTubeUrl);
    youtubeSessionControl.hidden = !(onYouTube && onlyYouTubeLinks);
    if (youtubeSessionControl.hidden && includeYouTubeCookies.checked) {
      includeYouTubeCookies.checked = false;
      youtubeCookiePermissionGranted = false;
      chrome.permissions.remove(youtubePermission).catch(() => {});
    }
  }

  function renderCount() {
    const count = extractUrls(input.value).length;
    linkCount.textContent = `${count} ${count === 1 ? 'link' : 'links'}`;
    sendButton.disabled = count === 0 || !configuredExePath;
  }

  function renderConfiguration() {
    setupNotice.hidden = Boolean(configuredExePath);
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
      pageTitle.textContent = 'No web page selected';
      pageHost.textContent = 'Paste links below to continue';
    }
  } catch (_) {
    pageTitle.textContent = 'Browser tab unavailable';
    pageHost.textContent = 'Paste links below to continue';
  }
  renderCount();
  updateSessionOption();
  if (activeTab?.url && isFacebookUrl(activeTab.url) && Number.isInteger(activeTab.id)) {
    capturedFacebookImageUrls = await captureFacebookPostImages(activeTab.id);
    // Facebook often inserts the remaining gallery thumbnails just after the
    // viewer opens. Give that DOM one short repaint window before falling back.
    if (capturedFacebookImageUrls.length < 2) {
      await new Promise(resolve => setTimeout(resolve, 350));
      capturedFacebookImageUrls = await captureFacebookPostImages(activeTab.id);
    }
    if (capturedFacebookImageUrls.length > 1) {
      setStatus(`พบรูปจริงในกรอบโพสต์ ${capturedFacebookImageUrls.length} รูป พร้อมส่งให้ ZELUX-DL`, 'success');
    }
  }

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

  async function requestSessionPermission(provider, checkbox) {
    const isYouTube = provider === 'youtube';
    const permission = isYouTube ? youtubePermission : facebookPermission;
    const validTab = isYouTube ? isYouTubeHost(activeTab?.url || '') : isFacebookUrl(activeTab?.url || '');
    const validLinks = extractUrls(input.value).every(isYouTube ? isYouTubeUrl : isFacebookUrl);
    const providerLabel = isYouTube ? 'YouTube' : 'Facebook';
    if (!checkbox.checked) {
      if (isYouTube) youtubeCookiePermissionGranted = false;
      else facebookCookiePermissionGranted = false;
      chrome.permissions.remove(permission).catch(() => {});
      setStatus(`Temporary ${providerLabel} session is off. No cookies will be sent.`, 'idle');
      return;
    }
    if (isYouTube && includeFacebookCookies.checked) {
      includeFacebookCookies.checked = false;
      facebookCookiePermissionGranted = false;
      chrome.permissions.remove(facebookPermission).catch(() => {});
    } else if (!isYouTube && includeYouTubeCookies.checked) {
      includeYouTubeCookies.checked = false;
      youtubeCookiePermissionGranted = false;
      chrome.permissions.remove(youtubePermission).catch(() => {});
    }
    if (!validTab || !validLinks) {
      checkbox.checked = false;
      setStatus(`Open ${providerLabel} and use only ${providerLabel} links for temporary session mode.`, 'error');
      return;
    }
    checkbox.disabled = true;
    setStatus(isYouTube
      ? 'Approve one-time YouTube-cookie and local-app access…'
      : 'Approve Brave’s one-time Facebook and local-app permission prompt…', 'busy');
    try {
      const granted = await chrome.permissions.request(permission);
      if (!granted) throw new Error(`Permission was not granted. No ${providerLabel} cookies were read.`);
      if (isYouTube) youtubeCookiePermissionGranted = true;
      else facebookCookiePermissionGranted = true;
      setStatus(`Permission approved. Only ${providerLabel} cookies will be sent locally for this job. Click Send to continue.`, 'success');
    } catch (error) {
      if (isYouTube) youtubeCookiePermissionGranted = false;
      else facebookCookiePermissionGranted = false;
      checkbox.checked = false;
      chrome.permissions.remove(permission).catch(() => {});
      setStatus(error.message || `Permission was not granted. No ${providerLabel} cookies were read.`, 'error');
    } finally {
      checkbox.disabled = false;
    }
  }

  includeFacebookCookies.addEventListener('change', () => requestSessionPermission('facebook', includeFacebookCookies));
  includeYouTubeCookies.addEventListener('change', () => requestSessionPermission('youtube', includeYouTubeCookies));

  input.addEventListener('input', () => {
    renderCount();
    updateSessionOption();
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !sendButton.disabled) sendLinks();
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
    const cookieProvider = includeYouTubeCookies.checked ? 'youtube'
      : includeFacebookCookies.checked ? 'facebook' : '';
    const useCookies = Boolean(cookieProvider);
    const providerLabel = cookieProvider === 'youtube' ? 'YouTube' : 'Facebook';
    setStatus(useCookies
      ? 'Opening ZELUX-DL directly. The opted-in session will be sent only after its identity is verified…'
      : `Handing ${urls.length} link${urls.length === 1 ? '' : 's'} to Windows…`, 'busy');
    try {
      let resultPromise;
      if (useCookies) {
        const isYouTube = cookieProvider === 'youtube';
        const validTab = isYouTube ? isYouTubeHost(activeTab?.url || '') : isFacebookUrl(activeTab?.url || '');
        const validUrls = urls.every(isYouTube ? isYouTubeUrl : isFacebookUrl);
        if (!validUrls || !validTab) {
          throw new Error(`Open ${providerLabel} and use only ${providerLabel} links for temporary session mode.`);
        }
        if (!Number.isInteger(activeTab?.id)) throw new Error(`No active ${providerLabel} tab. Reopen the extension on ${providerLabel} and try again.`);
        if (urls.length > 200) throw new Error('A batch can contain up to 200 URLs.');
        const permissionGranted = isYouTube ? youtubeCookiePermissionGranted : facebookCookiePermissionGranted;
        if (!permissionGranted) throw new Error(`First enable the ${providerLabel} session option and approve the permission prompt. No cookies were read.`);
        const cookieToken = createCookieToken();
        const protocolUrl = buildProtocolUrl(urls, cookieToken, configuredExePath, capturedFacebookImageUrls);
        if (protocolUrl.length > 30000) throw new Error('The URL list is too long to open directly. Send a smaller batch.');
        resultPromise = chrome.runtime.sendMessage({
          type: 'launch-download',
          urls,
          tabId: activeTab?.id,
          includeFacebookCookies: !isYouTube,
          includeYouTubeCookies: isYouTube,
          cookieToken,
          imageUrls: capturedFacebookImageUrls,
          protocolAlreadyLaunched: true,
        });
        launchProtocolFromPopup(protocolUrl);
      } else {
        resultPromise = chrome.runtime.sendMessage({
          type: 'launch-download',
          urls,
          tabId: activeTab?.id,
          includeFacebookCookies: false,
          includeYouTubeCookies: false,
          imageUrls: capturedFacebookImageUrls,
        });
      }
      const result = await resultPromise;
      if (!result?.ok) throw new Error(result?.error || 'Could not hand links to ZELUX-DL.');
      setStatus(result.usedTemporaryCookies
        ? `Sent a temporary ${providerLabel} session locally for ${result.count} link${result.count === 1 ? '' : 's'}. ZELUX-DL removes its temporary file after the job.`
        : `Requested Windows to open ${result.count} link${result.count === 1 ? '' : 's'} with ZELUX-DL. If nothing opens, check protocol registration.`, 'success');
    } catch (error) {
      const detail = error.message || 'Could not send the link to ZELUX-DL.';
      setStatus(/no cookies were sent|cookie bridge|identity verification|local ZELUX-DL/i.test(detail)
        ? detail
        : `${detail} Check that ZELUX-DL is installed and its zelux:// handler is registered.`, 'error');
    } finally {
      if (useCookies) {
        facebookCookiePermissionGranted = false;
        youtubeCookiePermissionGranted = false;
        includeFacebookCookies.checked = false;
        includeYouTubeCookies.checked = false;
      }
      renderCount();
    }
  }

  function createCookieToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function buildProtocolUrl(urls, cookieToken, exePath, imageUrls = []) {
    const query = new URLSearchParams({ urls: JSON.stringify(urls), cookieToken, exePath });
    const safeImages = [...new Set((Array.isArray(imageUrls) ? imageUrls : []).map(isFacebookImageUrl).filter(Boolean))].slice(0, 200);
    if (safeImages.length) query.set('imageUrls', JSON.stringify(safeImages));
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
