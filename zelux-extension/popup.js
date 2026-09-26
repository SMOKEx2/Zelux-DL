document.addEventListener('DOMContentLoaded', async () => {
  const input = document.getElementById('urlInput');
  const sendButton = document.getElementById('sendBtn');
  const scanButton = document.getElementById('scanBtn');
  const linkCount = document.getElementById('linkCount');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const pageTitle = document.getElementById('page-title');
  const pageHost = document.getElementById('page-host');
  let activeTab = null;

  function extractUrls(value) {
    const matches = String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    return [...new Set(matches.map(url => url.replace(/[),;]+$/g, '')).filter(isHttpUrl))];
  }

  function isHttpUrl(value) {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch (_) { return false; }
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

  input.addEventListener('input', renderCount);
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
    setStatus(`Handing ${urls.length} link${urls.length === 1 ? '' : 's'} to Windows…`, 'busy');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'launch-download',
        urls,
        tabId: activeTab?.id,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not hand links to ZELUX-DL.');
      setStatus(`Requested Windows to open ${result.count} link${result.count === 1 ? '' : 's'} with ZELUX-DL. If nothing opens, check protocol registration.`, 'success');
    } catch (error) {
      setStatus(`${error.message} Check that ZELUX-DL is installed and its zelux:// handler is registered.`, 'error');
    } finally {
      scanButton.disabled = false;
      renderCount();
    }
  }

  sendButton.addEventListener('click', sendLinks);
});
