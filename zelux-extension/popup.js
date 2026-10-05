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
  let capturedTikTokPost = null;
  let photoModel = null;
  let photoSources = [];
  let photoSourceKey = '';
  let photoCaptureGeneration = 0;
  let capturingPhotos = false;
  let sending = false;
  const photoPicker = document.getElementById('photoPicker');
  const photoGrid = document.getElementById('photoGrid');
  const linksEditor = document.getElementById('linksEditor');
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
      if (/\/v\/t39\.30808-1\//i.test(parsed.pathname) && !/\d{3,5}x\d{3,5}/.test(hints)) return false;
      parsed.hash = '';
      return parsed.href;
    } catch (_) { return false; }
  }

  function dedupeFacebookImageUrls(values) {
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

  async function captureFacebookPostImages(tabId) {
    if (!Number.isInteger(tabId) || !isFacebookUrl(activeTab?.url || '')) return { urls: [], action: 'idle' };
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
              if (/\/v\/t39\.30808-1\//i.test(parsed.pathname) && !/\d{3,5}x\d{3,5}/.test(hints)) return;
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
          const addEmbeddedUrls = html => {
            const normalized = String(html || '')
              .replace(/\\u0025/gi, '%').replace(/\\u0026/gi, '&')
              .replace(/\\u003d/gi, '=').replace(/\\u002f/gi, '/')
              .replace(/\\\//g, '/').replace(/&amp;/gi, '&');
            for (const match of normalized.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) add(match[0].replace(/[),;]+$/g, ''));
          };
          // Facebook keeps the rest of a gallery in lazy/hidden img nodes.
          // Read those nodes too; the CDN/size checks above remove avatars and UI assets.
          for (const image of root.querySelectorAll?.('img') || []) {
            add(largestSrcset(image.getAttribute('srcset') || image.getAttribute('data-srcset')));
            add(image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-original'));
            add(image.getAttribute('data-image-url'));
          }
          for (const element of root.querySelectorAll?.('[style*="background-image"],a[href]') || []) {
            const style = element.getAttribute?.('style') || '';
            for (const match of style.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) add(match[1]);
            const href = element.getAttribute?.('href') || '';
            if (/scontent\.|fbsbx\.com/i.test(href)) add(href);
          }
          addEmbeddedUrls(root.outerHTML);
          const collectVisibleImages = scope => {
            for (const image of scope?.querySelectorAll?.('img') || []) {
              const source = image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-original');
              const width = Number(image.naturalWidth || image.width || 0);
              const height = Number(image.naturalHeight || image.height || 0);
              const alt = String(image.alt || '');
              // Gallery images are large and carry Facebook's image alt text.
              // This excludes avatars, reaction icons and comment GIFs.
              if (width >= 300 && height >= 300 && (alt.includes('รูปภาพ') || alt.includes('image'))) add(source);
            }
          };
          collectVisibleImages(root);
          // A `+6` overlay is the gallery's explicit affordance for hidden items.
          // Open Facebook's viewer, then walk its next-image control. The viewer
          // is the only reliable place where Facebook exposes every gallery item.
          const more = [...(root.querySelectorAll?.('div,span,a,button,[role="button"]') || [])].find(element => {
            const text = String(element.textContent || '').trim();
            const rect = element.getBoundingClientRect?.();
            return /^\+\s*\d+$/.test(text) && rect && rect.width > 0 && rect.height > 0;
          });
          if (more) {
            // Return immediately after this click. Facebook may navigate the
            // tab to /photo; awaiting here would destroy this execution world.
            (more.closest?.('a,button,[role="button"]') || more.parentElement || more).click();
            return { urls: [...new Set(candidates)], action: 'open-gallery' };
          }
          // Once the viewer is mounted, capture its current image and advance
          // exactly one item. The caller waits for Facebook to repaint before
          // injecting the next step, so route changes cannot lose the result.
          const viewer = document.querySelector('[role="dialog"]');
          collectVisibleImages(viewer || document);
          const next = [...(viewer?.querySelectorAll?.('[role="button"],[aria-label]') || [])]
            .find(element => String(element.getAttribute?.('aria-label') || '').includes('รูปภาพถัดไป'));
          if (next) {
            next.click();
            return { urls: [...new Set(candidates)], action: 'next' };
          }
          return { urls: [...new Set(candidates)], action: 'idle' };
        },
      });
      const result = response?.[0]?.result || {};
      return {
        urls: dedupeFacebookImageUrls(result.urls || []),
        action: result.action || 'idle',
      };
    } catch (_) {
      return { urls: [], action: 'idle' };
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
    sendButton.disabled = count === 0 || !configuredExePath || capturingPhotos || sending || Boolean(photoModel && !photoModel.selected.size);
    sendButton.querySelector('span').textContent = photoModel ? `ดาวน์โหลด ${photoModel.selected.size} รูปที่เลือก` : 'Send to ZELUX-DL';
  }

  function renderPhotos() {
    photoPicker.hidden = !photoModel;
    document.body.classList.toggle('photo-mode', Boolean(photoModel));
    if (!photoModel) { linksEditor.hidden = false; renderCount(); return; }
    const m = photoModel;
    document.getElementById('photoTotal').textContent = `${m.total} รูป`;
    document.getElementById('photoSelectionCount').textContent = `เลือก ${m.selected.size} จาก ${m.total} รูป · รวมทุกหน้า`;
    const visible = m.visible();
    document.getElementById('photoPage').textContent = `หน้า ${m.page + 1}/${m.pages} · รูป ${visible[0]}–${visible.at(-1)}`;
    document.getElementById('previousPhotos').disabled = m.page === 0;
    document.getElementById('nextPhotos').disabled = m.page === m.pages - 1;
    photoGrid.replaceChildren();
    for (const n of visible) {
      const tile = document.createElement('button');
      tile.type = 'button'; tile.className = 'photo-tile';
      tile.dataset.photo = String(n);
      tile.setAttribute('aria-label', `รูปที่ ${n}`);
      tile.setAttribute('aria-pressed', String(m.selected.has(n)));
      const fallback = document.createElement('span');
      fallback.className = 'photo-fallback'; fallback.textContent = 'กำลังโหลด…';
      const img = document.createElement('img');
      img.alt = `รูปที่ ${n}`; img.referrerPolicy = 'no-referrer'; img.hidden = true;
      img.addEventListener('load', () => { img.hidden = false; });
      img.addEventListener('error', () => { img.hidden = true; fallback.textContent = 'ไม่มีภาพตัวอย่าง'; });
      img.src = photoSources[n - 1];
      const number = document.createElement('span'); number.className = 'photo-number'; number.textContent = n;
      const check = document.createElement('span'); check.className = 'photo-check'; check.textContent = m.selected.has(n) ? '✔' : '○';
      check.setAttribute('aria-hidden', 'true');
      tile.append(fallback, img, number, check);
      tile.addEventListener('click', () => {
        m.toggle(n);
        tile.setAttribute('aria-pressed', String(m.selected.has(n)));
        check.textContent = m.selected.has(n) ? '✔' : '○';
        document.getElementById('photoSelectionCount').textContent = `เลือก ${m.selected.size} จาก ${m.total} รูป · รวมทุกหน้า`;
        renderCount();
      });
      photoGrid.append(tile);
    }
    renderCount();
  }

  async function preparePhotos() {
    const generation = ++photoCaptureGeneration;
    const urls = extractUrls(input.value);
    photoModel = null; photoSources = []; capturedTikTokPost = null;
    photoSourceKey = JSON.stringify(urls);
    renderPhotos();
    if (urls.length !== 1) return;
    if (isFacebookUrl(urls[0]) && /\/(?:posts\/|share\/p\/|photos\/)|\/photo(?:\.php|\/|\?)/i.test(new URL(urls[0]).pathname + new URL(urls[0]).search) && capturedFacebookImageUrls.length) {
      photoSources = [...capturedFacebookImageUrls];
    } else if (ZeluxTikTokPhotos.isTikTokUrl(urls[0]) && ZeluxTikTokPhotos.isTikTokUrl(activeTab?.url) && Number.isInteger(activeTab?.id)) {
      capturingPhotos = true; renderCount();
      setStatus('กำลังตรวจสอบรูปในโพสต์ TikTok…', 'busy');
      let capture = null;
      try {
        await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, world: 'MAIN', files: ['tiktok-photos.js'] });
        const results = await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, world: 'MAIN', func: () => globalThis.ZeluxTikTokPhotos.captureDocument(document, location.href) });
        capture = ZeluxTikTokPhotos.normalizeCapture(results?.[0]?.result, urls);
      } catch (_) { /* App can inspect links that cannot be captured in this tab. */ }
      if (generation !== photoCaptureGeneration) return;
      capturedTikTokPost = capture;
      photoSources = capture?.images.map(image => image.urls[0]) || [];
      capturingPhotos = false;
    }
    if (generation !== photoCaptureGeneration) return;
    if (photoSources.length) {
      photoModel = ZeluxPhotoSelection.create(photoSources.length);
      linksEditor.hidden = true;
      setStatus('กดที่รูปเพื่อเลือกหรือเอาออกก่อนดาวน์โหลด', 'idle');
    } else if (ZeluxTikTokPhotos.isTikTokPhotoUrl(urls[0])) {
      setStatus('ยังอ่านรูปไม่ได้ รอหน้าโพสต์โหลดแล้วเปิด Extension ใหม่ หรือเลือกเลขรูปในแอป', 'error');
    } else setStatus('Ready to capture links.', 'idle');
    renderPhotos();
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
  async function prepareFacebookPhotos() {
    if (!(activeTab?.url && isFacebookUrl(activeTab.url) && Number.isInteger(activeTab.id))) return;
    const sourceKey = JSON.stringify(extractUrls(input.value));
    capturingPhotos = true; renderCount();
    setStatus('กำลังตรวจสอบรูปในโพสต์ Facebook…', 'busy');
    capturedFacebookImageUrls = [];
    // Facebook changes the tab route when `+N` is opened. Inject one short,
    // synchronous step at a time so a navigation cannot cancel a long script.
    let unchangedPasses = 0;
    let idlePasses = 0;
    let galleryStarted = false;
    for (let pass = 0; pass < 24; pass++) {
      const batch = await captureFacebookPostImages(activeTab.id);
      const previousCount = capturedFacebookImageUrls.length;
      capturedFacebookImageUrls = dedupeFacebookImageUrls([...capturedFacebookImageUrls, ...batch.urls]);
      unchangedPasses = capturedFacebookImageUrls.length === previousCount ? unchangedPasses + 1 : 0;
      if (batch.action !== 'idle') {
        galleryStarted = true;
        idlePasses = 0;
      } else {
        idlePasses += 1;
      }
      if ((!galleryStarted && batch.action === 'idle') || unchangedPasses >= 3 || (galleryStarted && idlePasses >= 3)) break;
      await new Promise(resolve => setTimeout(resolve, 900));
    }
    capturingPhotos = false;
    if (sourceKey !== JSON.stringify(extractUrls(input.value))) capturedFacebookImageUrls = [];
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
    capturingPhotos = false;
    photoCaptureGeneration++;
    photoModel = null;
    capturedTikTokPost = null;
    // Captured images belong to the original tab, never to a pasted different post.
    if (extractUrls(input.value)[0] !== activeTab?.url) capturedFacebookImageUrls = [];
    renderPhotos();
    renderCount();
    updateSessionOption();
    clearTimeout(input.photoTimer);
    input.photoTimer = setTimeout(preparePhotos, 250);
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !sendButton.disabled) sendLinks();
  });

  async function sendLinks() {
    if (sendButton.disabled || sending) return;
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
    sending = true;
    sendButton.disabled = true;
    const selection = photoModel && photoSourceKey === JSON.stringify(urls) ? photoModel.payload() : null;
    const imageUrls = selection && !capturedTikTokPost ? selection.positions.map(n => capturedFacebookImageUrls[n - 1]) : [];
    const tikTokPost = selection && capturedTikTokPost ? { ...capturedTikTokPost, images: selection.positions.map(n => capturedTikTokPost.images[n - 1]) } : null;
    const countPhotos = selection?.positions.length || 0;
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
        const protocolUrl = buildProtocolUrl(urls, cookieToken, configuredExePath, imageUrls, tikTokPost, selection);
        if (protocolUrl.length > 30000) throw new Error('The URL list is too long to open directly. Send a smaller batch.');
        resultPromise = chrome.runtime.sendMessage({
          type: 'launch-download',
          urls,
          tabId: activeTab?.id,
          includeFacebookCookies: !isYouTube,
          includeYouTubeCookies: isYouTube,
          cookieToken,
          imageUrls,
          tikTokPost,
          photoSelection: selection,
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
          imageUrls,
          tikTokPost,
          photoSelection: selection,
        });
      }
      const result = await resultPromise;
      if (!result?.ok) throw new Error(result?.error || 'Could not hand links to ZELUX-DL.');
      setStatus(result.usedTemporaryCookies
        ? `Sent a temporary ${providerLabel} session locally for ${result.count} link${result.count === 1 ? '' : 's'}. ZELUX-DL removes its temporary file after the job.`
        : countPhotos
          ? `ส่ง ${countPhotos} รูปที่เลือกไปยัง ZELUX-DL แล้ว · เก็บเลขรูปตามโพสต์เดิม`
          : `Requested Windows to open ${result.count} link${result.count === 1 ? '' : 's'} with ZELUX-DL. If nothing opens, check protocol registration.`, 'success');
    } catch (error) {
      const detail = error.message || 'Could not send the link to ZELUX-DL.';
      setStatus(/no cookies were sent|cookie bridge|identity verification|local ZELUX-DL/i.test(detail)
        ? detail
        : `${detail} Check that ZELUX-DL is installed and its zelux:// handler is registered.`, 'error');
    } finally {
      sending = false;
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

  function buildProtocolUrl(urls, cookieToken, exePath, imageUrls = [], tikTokPost = null, photoSelection = null) {
    const query = new URLSearchParams({ urls: JSON.stringify(urls), cookieToken, exePath });
    const safeImages = dedupeFacebookImageUrls(imageUrls);
    if (safeImages.length) query.set('imageUrls', JSON.stringify(safeImages));
    if (tikTokPost) query.set('tikTokPost', JSON.stringify(tikTokPost));
    if (photoSelection) query.set('photoSelection', JSON.stringify(photoSelection));
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
  document.getElementById('selectAllPhotos').addEventListener('click', () => { photoModel?.all(); renderPhotos(); });
  document.getElementById('clearPhotos').addEventListener('click', () => { photoModel?.clear(); renderPhotos(); });
  document.getElementById('previousPhotos').addEventListener('click', () => { photoModel?.turn(-1); renderPhotos(); });
  document.getElementById('nextPhotos').addEventListener('click', () => { photoModel?.turn(1); renderPhotos(); });
  document.getElementById('editLinks').addEventListener('click', () => { linksEditor.hidden = !linksEditor.hidden; if (!linksEditor.hidden) input.focus(); });
  await prepareFacebookPhotos();
  await preparePhotos();
});
