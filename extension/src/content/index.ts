/** Content script (all frames, document_start): bypass modifier + video button. */
import { api } from '../shared/api';
import { STATE_KEY, normalizeState } from '../shared/settings';
import { initBypass, setBypassKey } from './bypass';
import { VideoButton } from './video-button';

declare global {
  interface Window {
    __prismContentLoaded?: boolean;
  }
}

if (!window.__prismContentLoaded) {
  window.__prismContentLoaded = true;
  initBypass();
  const button = new VideoButton();

  const apply = (raw: unknown) => {
    const st = normalizeState(raw);
    setBypassKey(st.settings.bypassKey);
    button.setVideoSites(st.settings.videoSites);
    const enable = () => button.setEnabled(st.settings.showVideoButton);
    if (document.documentElement) enable();
    else document.addEventListener('DOMContentLoaded', enable, { once: true });
  };

  api.storage.local
    .get(STATE_KEY)
    .then((r) => apply(r[STATE_KEY]))
    .catch(() => apply(undefined));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STATE_KEY]) apply(changes[STATE_KEY].newValue);
  });
  // Context menu "Download with ZeluxDL" on a video that has no downloadable URL (blob:).
  api.runtime.onMessage.addListener((msg: { kind?: string } | undefined, _sender, sendResponse) => {
    if (msg?.kind !== 'showVideoMenu') return false;
    sendResponse({ ok: button.openForContextMenu() });
    return false;
  });
}
