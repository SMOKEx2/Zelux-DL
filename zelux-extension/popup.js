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
  document.querySelector('.version').textContent = `v${chrome.runtime.getManifest().version}`;
  let activeTab = null;

  const facebookPermission = {
    permissions: ['cookies'],
    origins: ['https://facebook.com/*', 'https://*.facebook.com/*', 'http://127.0.0.1/*'],
  };

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
    if (sessionControl.hidden) includeFacebookCookies.checked = false;
  }

  function renderCount() {
    const count = extractUrls(input.value).length;
    linkCount.textContent = `${count} ${count === 1 ? 'link' : 'links'}`;
    sendButton.disabled = count === 0;
  }

  function setStatus(message, kind = 'idle') {
    statusText.textContent = message;
    status.dataset.kind = kind;
  }

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
  renderCount();
  updateSessionOption();

  input.addEventListener('input', () => {
    renderCount();
    updateSessionOption();
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !sendButton.disabled) sendLinks();
  });

  scanButton.addEventListener('click', async () => {
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
      scanButton.disabled = false;
    }
  });

  async function sendLinks() {
    const urls = extractUrls(input.value);
    if (!urls.length) {
      setStatus('Paste at least one valid HTTP or HTTPS link.', 'error');
      return;
    }
    sendButton.disabled = true;
    scanButton.disabled = true;
    const useCookies = includeFacebookCookies.checked;
    setStatus(useCookies
      ? 'Requesting one-time Facebook and local-app permissions…'
      : `Handing ${urls.length} link${urls.length === 1 ? '' : 's'} to Windows…`, 'busy');
    try {
      if (useCookies) {
        if (!urls.every(isFacebookUrl) || !isFacebookUrl(activeTab?.url || '')) {
          throw new Error('Open Facebook and use only Facebook links for temporary session mode.');
        }
        const granted = await chrome.permissions.request(facebookPermission);
        if (!granted) throw new Error('Permission was not granted. No Facebook cookies were read.');
      }
      const result = await chrome.runtime.sendMessage({
        type: 'launch-download',
        urls,
        tabId: activeTab?.id,
        includeFacebookCookies: useCookies,
      });
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
      scanButton.disabled = false;
      renderCount();
    }
  }

  sendButton.addEventListener('click', sendLinks);
});
