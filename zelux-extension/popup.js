document.addEventListener('DOMContentLoaded', async () => {
  const input = document.getElementById('urlInput');
  const btn = document.getElementById('downloadBtn');

  // Auto-fill active tab URL
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\//i.test(tab.url)) input.value = tab.url;
  } catch (e) {}

  function extractUrls(value) {
    const matches = String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    return [...new Set(matches.map(url => url.replace(/[),;]+$/g, '')))];
  }

  async function sendUrlsToZelux(urls, buttonEl) {
    const originalText = buttonEl.innerText || '';
    
    if (buttonEl.tagName === 'BUTTON') {
      buttonEl.innerText = 'Sent! 🚀';
      buttonEl.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.runtime.sendMessage({
        type: 'launch-download',
        urls,
        tabId: tab?.id
      });
      if (!result?.ok) throw new Error(result?.error || 'Unable to open ZELUX-DL');
      if (buttonEl.tagName === 'BUTTON') buttonEl.innerText = `Sent ${result.count} link${result.count === 1 ? '' : 's'}! 🚀`;
    } catch(e) {
      if (buttonEl.tagName === 'BUTTON') {
        buttonEl.innerText = 'Open failed';
        buttonEl.style.background = '#ef4444';
      }
      console.error('[ZELUX-DL]', e);
    }

    setTimeout(() => {
      if (buttonEl.tagName === 'BUTTON') {
        buttonEl.innerText = originalText;
        buttonEl.style.background = '';
      }
      if (buttonEl.id === 'downloadBtn') {
        input.value = '';
      }
    }, 1500);
  }

  btn.addEventListener('click', () => {
    const urls = extractUrls(input.value);
    if (!urls.length) {
      input.style.border = '1px solid #ef4444';
      setTimeout(() => input.style.border = '1px solid transparent', 1000);
      return;
    }
    sendUrlsToZelux(urls, btn);
  });
});
