import { api, sendInternal } from '../shared/api';
import { prismMark } from '../shared/icons';
import type { CaptureSettings } from '../shared/protocol';
import { DEFAULT_SETTINGS, STATE_KEY, type StoredState, normalizeState } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const status = $<HTMLSpanElement>('status');

$('mark').innerHTML = prismMark(40);

function setStatus(text: string, kind: '' | 'ok' | 'bad' = ''): void {
  status.textContent = text;
  status.className = `muted small ${kind}`;
}

function fill(s: CaptureSettings, st?: StoredState): void {
  $<HTMLInputElement>('captureEnabled').checked = s.captureEnabled;
  $<HTMLInputElement>('showVideoButton').checked = s.showVideoButton;
  $<HTMLSelectElement>('bypassKey').value = s.bypassKey;
  $<HTMLTextAreaElement>('extensions').value = s.extensions.join(' ');
  $<HTMLTextAreaElement>('mimeTypes').value = s.mimeTypes.join('\n');
  $<HTMLInputElement>('minSize').value = String(Math.round(s.minSize / 1024));
  $<HTMLTextAreaElement>('excludedSites').value = s.excludedSites.join('\n');
  $<HTMLTextAreaElement>('videoSites').value = s.videoSites.join('\n');
  if (st) {
    $('source-line').textContent =
      st.settingsSource === 'app'
        ? `การตั้งค่าเป็นไปตามโปรแกรม ZeluxDL${st.appVersion ? ` (v${st.appVersion})` : ''} การบันทึกที่นี่จะแทนที่เฉพาะในส่วนขยายนี้`
        : 'กำลังใช้การตั้งค่าเฉพาะส่วนขยาย กด "ซิงค์จาก ZeluxDL" เพื่อกลับไปใช้ค่าของโปรแกรม';
  }
}

function read(): Partial<CaptureSettings> {
  const lines = (id: string) => $<HTMLTextAreaElement>(id).value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return {
    captureEnabled: $<HTMLInputElement>('captureEnabled').checked,
    showVideoButton: $<HTMLInputElement>('showVideoButton').checked,
    bypassKey: $<HTMLSelectElement>('bypassKey').value as CaptureSettings['bypassKey'],
    extensions: $<HTMLTextAreaElement>('extensions').value.split(/[\s,;]+/).filter(Boolean),
    mimeTypes: lines('mimeTypes'),
    minSize: Math.max(0, Number($<HTMLInputElement>('minSize').value) || 0) * 1024,
    excludedSites: lines('excludedSites'),
    videoSites: lines('videoSites'),
  };
}

async function load(): Promise<void> {
  const r = await api.storage.local.get(STATE_KEY);
  const st = normalizeState(r[STATE_KEY]);
  fill(st.settings, st);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await sendInternal<{ ok: boolean; state?: StoredState; error?: string }>({ kind: 'saveSettings', settings: read() });
  if (r?.ok && r.state) {
    fill(r.state.settings, r.state);
    setStatus('บันทึกเรียบร้อยแล้ว', 'ok');
  } else setStatus(r?.error ?? 'ไม่สามารถบันทึกได้', 'bad');
});

$('reset').addEventListener('click', () => {
  fill(DEFAULT_SETTINGS);
  setStatus('คืนค่าเริ่มต้นแล้ว — กดบันทึกเพื่อใช้งาน');
});

$('sync').addEventListener('click', async () => {
  setStatus('กำลังสอบถาม ZeluxDL…');
  const r = await sendInternal<{ ok: boolean; state?: StoredState; error?: string }>({ kind: 'syncSettings' });
  if (r?.ok && r.state) {
    fill(r.state.settings, r.state);
    setStatus('ซิงค์การตั้งค่าจาก ZeluxDL สำเร็จ', 'ok');
  } else setStatus(`ไม่สามารถติดต่อ ZeluxDL ได้: ${r?.error ?? 'ไม่มีการตอบสนอง'} โปรแกรมกำลังทำงานอยู่หรือไม่?`, 'bad');
});

void load();
