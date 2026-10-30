import { api, sendInternal } from '../shared/api';
import { icons, prismMark } from '../shared/icons';
import { type MediaItem, humanSize } from '../shared/media';
import type { ActionResult, ConnectionInfo, PopupState, PostMediaResult, VideoOption, VideoOptionsResult } from '../shared/messages';
import type { BatchKind } from '../shared/protocol';
import type { PostMediaEntry } from '../shared/protocol';
import { isSinglePostMediaUrl, isSocialMediaUrl } from '../shared/social-post';

const app = document.getElementById('app')!;
let tabId = -1;
let state: PopupState | null = null;
let busy = false;
let postEntries: PostMediaEntry[] = [];
let postSelected = new Set<number>();
let postLoading = false;
let postError = '';
let postUseSession = false;
let videoOptions: VideoOption[] = [];
let videoLoading = false;
let videoError = '';

function youtubeVideoPage(raw: string): boolean {
  try {
    const u = new URL(raw);
    return /(^|\.)youtube(-nocookie)?\.com$/i.test(u.hostname) && (!!u.searchParams.get('v') || /^\/shorts\/[^/]+/.test(u.pathname));
  } catch {
    return false;
  }
}

function isVideo(entry: PostMediaEntry): boolean {
  return ['mp4', 'webm', 'mov', 'm4v'].includes((entry.extension ?? '').toLowerCase());
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function toast(text: string, bad = false): void {
  let t = document.querySelector<HTMLDivElement>('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast glass';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(setTimeout(() => t!.classList.remove('show'), 2200));
}

function chip(c: ConnectionInfo): string {
  if (c.state === 'connected') return `<span class="chip ok" id="conn" data-state="connected"><span class="dot"></span>เชื่อมต่อแล้ว${c.appVersion ? ` · v${esc(c.appVersion)}` : ''}</span>`;
  if (c.state === 'unknown') return `<span class="chip unknown" id="conn" data-state="unknown"><span class="dot"></span>กำลังตรวจสอบ…</span>`;
  return `<span class="chip bad" id="conn" data-state="${c.state}"><span class="dot"></span>ไม่ได้เชื่อมต่อ</span>`;
}

function alertCard(c: ConnectionInfo): string {
  if (c.state === 'connected' || c.state === 'unknown') return '';
  const missing = c.state === 'host_missing';
  const title = missing ? 'ยังไม่ได้ติดตั้งส่วนเชื่อมต่อเบราว์เซอร์' : 'ไม่สามารถเชื่อมต่อ ZeluxDL ได้';
  const hint = missing
    ? 'วิธีแก้ไข: เปิด ZeluxDL › การตั้งค่า › ส่วนเชื่อมต่อเบราว์เซอร์ แล้วคลิก "ซ่อมแซม"'
    : 'โปรดเปิดโปรแกรม ZeluxDL หรือไปที่ ZeluxDL › การตั้งค่า › ส่วนเชื่อมต่อเบราว์เซอร์ › ซ่อมแซม ระหว่างนี้จะดาวน์โหลดผ่านเบราว์เซอร์ตามปกติ';
  return `<section class="alert glass" id="fix">
    <span class="ic">${icons.alert(18)}</span><b>${title}</b>
    <p>${hint}${c.error ? `<br><span class="small">รายละเอียด: ${esc(c.error)}</span>` : ''}</p>
    <div class="actions">
      ${missing ? '' : `<button class="btn primary" data-act="launch">${icons.external(14)}เปิด ZeluxDL</button>`}
      <button class="btn" data-act="retry">${icons.refresh(14)}ลองใหม่</button>
    </div>
  </section>`;
}

function kindIcon(m: MediaItem): string {
  if (m.kind === 'audio') return icons.audio(16);
  if (m.kind === 'hls' || m.kind === 'dash') return icons.stream(16);
  return icons.film(16);
}

function mediaMeta(m: MediaItem): string {
  const kind = m.kind === 'hls' ? 'HLS' : m.kind === 'dash' ? 'DASH' : m.mime || m.kind;
  return [kind, m.quality, humanSize(m.size)].filter(Boolean).join(' · ');
}

function render(): void {
  if (!state) return;
  const { connection, media, state: st } = state;
  const postUrl = isSinglePostMediaUrl(state.tabUrl ?? '');
  const socialPage = isSocialMediaUrl(state.tabUrl ?? '');
  const youtube = youtubeVideoPage(state.tabUrl ?? '');
  const capturing = st.settings.captureEnabled && !st.paused;
  app.innerHTML = `
    <header class="top">
      <span class="tile">${prismMark(24)}</span>
      <div class="brand"><b>ZeluxDL</b><span class="muted">โปรแกรมช่วยดาวน์โหลด</span></div>
      ${chip(connection)}
    </header>
    ${alertCard(connection)}
    <section class="row glass">
      <div class="tx"><b>จับการดาวน์โหลด</b><span>${
        !st.settings.captureEnabled ? 'ปิดใช้งานในการตั้งค่า' : st.paused ? 'หยุดชั่วคราว — เบราว์เซอร์จะดาวน์โหลดเอง' : 'ส่งไฟล์ที่ตรงกันไปยัง ZeluxDL'
      }</span></div>
      <label class="switch" title="หยุดจับการดาวน์โหลดชั่วคราว"><input type="checkbox" id="capture" ${capturing ? 'checked' : ''} ${
        st.settings.captureEnabled ? '' : 'disabled'
      } aria-label="จับการดาวน์โหลด"><span></span></label>
    </section>
    ${socialPage ? `<section class="section glass post-picker">
      ${postUrl ? `<h2>สื่อจากโพสต์นี้</h2>
      <p class="muted">แสดงเฉพาะรูปและคลิปจากโพสต์นี้ เลือกรายการก่อนส่งไปยัง ZeluxDL</p>
      <label class="post-session"><input type="checkbox" data-act="postSession" ${postUseSession ? 'checked' : ''}><span><b>ใช้ session ของเว็บนี้กับโพสต์นี้</b><small>ส่งให้ ZeluxDL บนเครื่องนี้ชั่วคราว และลบเมื่อดาวน์โหลดจบ; ไม่เปลี่ยนการเข้าสู่ระบบในเบราว์เซอร์</small></span></label>
      ${!postEntries.length ? `<button class="btn primary" data-act="probePostMedia" ${postLoading ? 'disabled' : ''}>${icons.image(16)}${postLoading ? 'กำลังอ่านโพสต์…' : 'แสดงรูปและคลิป'}</button>` : `
        <div class="post-selectbar"><span>${postSelected.size} / ${postEntries.length} เลือกแล้ว</span><button class="btn" data-act="selectAllPost">เลือกทั้งหมด</button><button class="btn" data-act="selectNoPost">ไม่เลือก</button></div>
        <div class="post-grid">${postEntries.map((entry, index) => `<button type="button" class="post-card${postSelected.has(index) ? ' selected' : ''}" data-act="togglePostMedia" data-index="${index}" aria-pressed="${postSelected.has(index)}" title="${esc(entry.title ?? `รายการ ${index + 1}`)}">
          ${!isVideo(entry) && (entry.thumbnail || entry.url) ? `<img src="${esc(entry.thumbnail || entry.url)}" loading="lazy" alt="${esc(entry.title ?? `รูป ${index + 1}`)}">` : `<span class="post-video">${icons.film(24)}</span>`}
          <span class="post-check">${postSelected.has(index) ? '✓' : index + 1}</span><span class="post-card-name">${esc(entry.title ?? `${isVideo(entry) ? 'คลิป' : 'รูป'} ${index + 1}`)}</span>
        </button>`).join('')}</div>
        <div class="post-download"><span>${postError ? esc(postError) : 'เฉพาะรายการที่เลือกจะถูกเพิ่มในคิว'}</span><button class="btn primary" data-act="downloadPostMedia" ${!postSelected.size || busy ? 'disabled' : ''}>${icons.download(14)}ดาวน์โหลด ${postSelected.size}</button></div>`}
      ${postError && !postEntries.length ? `<p class="post-error">${esc(postError)}</p>` : ''}` : `<h2>เปิดลิงก์โพสต์เดียวก่อน</h2>
      <p class="muted">ไม่กวาดสื่อจากหน้า feed หรือ search เพื่อป้องกันรูปและคลิปจากหลายโพสต์ปนกัน</p>`}
    </section>` : youtube ? `<section class="section glass">
      <h2>วิดีโอ YouTube</h2>
      <p class="muted">YouTube แบ่งวิดีโอเป็นสตรีม จึงไม่แสดงในรายการสื่อทั่วไป</p>
      ${videoOptions.length ? `<div class="list">${videoOptions.map((o) => `<div class="media"><span class="kind">${icons.film(16)}</span><span class="tx"><span class="name">${esc(o.label)}</span><span class="meta">${esc(o.detail ?? '')}</span></span><button class="btn" data-act="youtubeDownload" data-option="${esc(o.id)}">${icons.download(14)}ดาวน์โหลด</button></div>`).join('')}</div>` : `<button class="btn primary" data-act="youtubeProbe" ${videoLoading ? 'disabled' : ''}>${icons.film(16)}${videoLoading ? 'กำลังอ่านคุณภาพ…' : 'แสดงคุณภาพวิดีโอ'}</button>${videoError ? `<p class="post-error">${esc(videoError)}</p>` : ''}`}
    </section>` : `<section class="section glass">
      <h2>สื่อในหน้านี้ <span class="count" id="media-count">${media.length}</span></h2>
      <div class="list" id="media">${
        media.length
          ? media
              .map(
                (m) => `<div class="media" data-key="${esc(m.key)}">
                  <span class="kind">${kindIcon(m)}</span>
                  <span class="tx"><span class="name" title="${esc(m.url)}">${esc(m.name)}</span><span class="meta">${esc(mediaMeta(m))}</span></span>
                  <button class="btn" data-act="media" data-key="${esc(m.key)}">${icons.download(14)}ดาวน์โหลด</button>
                </div>`,
              )
              .join('')
          : `<div class="empty"><b>ยังไม่พบสื่อในหน้านี้</b>เล่นวิดีโอหรือเสียงในหน้านี้เพื่อแสดงที่นี่</div>`
      }</div>
    </section>`}
    <footer class="foot">
      <button class="btn ghost" data-act="open">${prismMark(16)}เปิด ZeluxDL</button>
      <span class="spacer"></span>
      <button class="btn ghost icon" data-act="options" title="การตั้งค่า" aria-label="การตั้งค่า">${icons.gear(16)}</button>
    </footer>`;
}

async function load(): Promise<void> {
  const s = await sendInternal<PopupState>({ kind: 'popupState', tabId });
  if (s) {
    state = s;
    render();
  }
}

async function refreshStatus(): Promise<void> {
  const c = await sendInternal<ConnectionInfo>({ kind: 'refreshStatus' });
  if (c && state) {
    state.connection = c;
    render();
  }
}

async function act(el: HTMLElement): Promise<void> {
  const a = el.dataset.act;
  if (a === 'togglePostMedia') {
    const index = Number(el.dataset.index);
    if (postSelected.has(index)) postSelected.delete(index);
    else postSelected.add(index);
    render();
    return;
  }
  if (a === 'selectAllPost' || a === 'selectNoPost') {
    postSelected = a === 'selectAllPost' ? new Set(postEntries.map((_, i) => i)) : new Set();
    render();
    return;
  }
  if (a === 'postSession') {
    postUseSession = (el as HTMLInputElement).checked;
    return;
  }
  if (busy) return;
  if (a === 'options') {
    await api.runtime.openOptionsPage();
    return;
  }
  busy = true;
  (el as HTMLButtonElement).disabled = true;
  try {
    let r: ActionResult | undefined;
    switch (a) {
      case 'media':
        r = await sendInternal<ActionResult>({ kind: 'downloadMedia', tabId, key: el.dataset.key! });
        if (r?.ok) toast('ส่งไปยัง ZeluxDL แล้ว');
        break;
      case 'collect':
        r = await sendInternal<ActionResult>({ kind: 'collect', tabId, mode: el.dataset.mode as BatchKind });
        if (r?.ok) toast(r.count ? `ส่ง ${r.count} รายการไปยัง ZeluxDL แล้ว` : 'ไม่พบรายการใดๆ ในหน้านี้');
        break;
      case 'postMedia':
        r = await sendInternal<ActionResult>({ kind: 'openPostMediaPicker', tabId });
        if (r?.ok) {
          toast('เปิดตัวเลือกสื่อของโพสต์แล้ว');
          window.close();
        }
        break;
      case 'probePostMedia': {
        postLoading = true;
        postError = '';
        render();
        const result = await sendInternal<PostMediaResult>({ kind: 'probePostMedia', tabId, useSession: postUseSession });
        postLoading = false;
        if (result?.ok && result.entries?.length) {
          postEntries = result.entries;
          postSelected = new Set();
        } else {
          postError = result?.error ?? 'ไม่พบรูปหรือคลิปในโพสต์นี้';
        }
        render();
        r = { ok: !!result?.ok, error: result?.error };
        break;
      }
      case 'youtubeProbe': {
        videoLoading = true;
        videoError = '';
        render();
        const result = await sendInternal<VideoOptionsResult>({ kind: 'videoOptions', tabId, pageUrl: state?.tabUrl ?? '', title: state?.tabTitle ?? document.title });
        videoLoading = false;
        if (result?.options.length) videoOptions = result.options;
        else videoError = result?.notice ?? 'ไม่พบคุณภาพวิดีโอในหน้านี้';
        render();
        r = { ok: !!result?.options.length, error: videoError };
        break;
      }
      case 'youtubeDownload': {
        const option = videoOptions.find((o) => o.id === el.dataset.option);
        if (!option) { r = { ok: false, error: 'ไม่พบตัวเลือกคุณภาพนี้แล้ว โปรดลองอ่านคุณภาพใหม่' }; break; }
        r = await sendInternal<ActionResult>({ kind: 'videoDownload', tabId, pageUrl: state?.tabUrl ?? '', title: state?.tabTitle ?? document.title, option });
        if (r?.ok) toast('ส่งวิดีโอไปยัง ZeluxDL แล้ว');
        break;
      }
      case 'downloadPostMedia': {
        const media = [...postSelected].sort((a, b) => a - b).map((i) => ({
          url: postEntries[i]!.url,
          extension: postEntries[i]!.extension ?? '',
          httpHeaders: postEntries[i]!.httpHeaders ?? {},
          index: i + 1,
        }));
        r = await sendInternal<ActionResult>({ kind: 'downloadPostMedia', tabId, useSession: postUseSession, media });
        if (r?.ok) toast(`เพิ่ม ${r.count ?? media.length} รายการในคิว ZeluxDL แล้ว`);
        break;
      }
      case 'open':
      case 'launch':
        r = await sendInternal<ActionResult>({ kind: 'openApp', page: 'main' });
        if (r?.ok) {
          if (a === 'open') window.close();
          else await refreshStatus();
        }
        break;
      case 'retry':
        r = await sendInternal<ActionResult>({ kind: 'retryConnection' });
        if (r?.ok) toast('เชื่อมต่อ ZeluxDL แล้ว');
        break;
    }
    if (r && !r.ok) toast(r.error ?? 'เกิดข้อผิดพลาด', true);
    if (!r) toast('ส่วนขยาย ZeluxDL กำลังเริ่มใหม่ — โปรดลองอีกครั้ง', true);
  } finally {
    busy = false;
    (el as HTMLButtonElement).disabled = false;
    if (a !== 'retry' && a !== 'launch') void refreshStatus();
  }
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (el) void act(el);
});
app.addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'capture') {
    await sendInternal({ kind: 'setPaused', paused: !t.checked });
    await load();
  }
});

(async () => {
  const q = new URLSearchParams(location.search).get('tabId');
  if (q) tabId = Number(q);
  else {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? -1;
  }
  await load();
  await refreshStatus();
})();
