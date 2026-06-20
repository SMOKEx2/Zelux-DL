document.addEventListener('DOMContentLoaded', async () => {
  const input = document.getElementById('urlInput');
  const btn = document.getElementById('downloadBtn');

  // Auto-fill active tab URL
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      if (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be/')) {
        input.value = tab.url;
      }
    }
  } catch (e) {}

  async function sendUrlToZelux(url, buttonEl) {
    const originalText = buttonEl.innerText || '';
    
    if (buttonEl.tagName === 'BUTTON') {
      buttonEl.innerText = 'Sent! 🚀';
      buttonEl.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (targetUrl) => {
          const iframe = document.createElement("iframe");
          iframe.style.display = "none";
          iframe.src = "zelux://" + targetUrl;
          document.body.appendChild(iframe);
          setTimeout(() => iframe.remove(), 2000);
        },
        args: [url]
      });
    } catch(e) {}

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
    const url = input.value.trim();
    if (!url) {
      input.style.border = '1px solid #ef4444';
      setTimeout(() => input.style.border = '1px solid transparent', 1000);
      return;
    }
    sendUrlToZelux(url, btn);
  });
});
