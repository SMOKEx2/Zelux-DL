/**
 * "Download all links / images / videos / selection links" — collects URLs in
 * every frame with `scripting.executeScript` and sends one `batch` message.
 */
import { api } from '../shared/api';
import type { BatchItem, BatchKind, BatchRequest } from '../shared/protocol';
import { filenameFromUrl } from '../shared/rules';
import { actionTimeout, cookieCache, tabInfo, userAgent } from './context';
import { native } from './native';
import { isSinglePostMediaUrl, isSocialMediaUrl } from '../shared/social-post';
import { openPostMediaPicker } from './video';

export interface CollectedItem {
  url: string;
  kind: 'link' | 'image' | 'video' | 'audio';
  text?: string;
}

export interface CollectResult {
  pageUrl: string;
  title: string;
  items: CollectedItem[];
}

/**
 * Runs inside the page (serialized by executeScript): must be self-contained.
 */
export function collectInPage(mode: BatchKind): CollectResult {
  const out: CollectedItem[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, kind: CollectedItem['kind'], text?: string | null) => {
    if (!raw) return;
    let abs: string;
    try {
      abs = new URL(raw, document.baseURI).href;
    } catch {
      return;
    }
    if (!/^(https?|ftp):/i.test(abs)) return;
    abs = abs.replace(/#.*$/, '');
    if (seen.has(abs)) return;
    seen.add(abs);
    const t = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    out.push(t ? { url: abs, kind, text: t } : { url: abs, kind });
  };
  const largestFromSrcset = (srcset: string | null): string | null => {
    if (!srcset) return null;
    let best: string | null = null;
    let bestW = -1;
    for (const part of srcset.split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 0;
      if (w > bestW) {
        bestW = w;
        best = u;
      }
    }
    return best;
  };
  const videoExt = /\.(mp4|m4v|webm|mkv|mov|avi|wmv|flv|ogv|3gp|m3u8|mpd)(\?|$)/i;
  const audioExt = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|wma)(\?|$)/i;
  const imageExt = /\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?|ico|heic)(\?|$)/i;

  if (mode === 'links' || mode === 'selection') {
    const sel = window.getSelection();
    const ranges: Range[] = [];
    if (mode === 'selection' && sel) for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i));
    const inSelection = (n: Node) => ranges.some((r) => r.intersectsNode(n));
    document.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]').forEach((a) => {
      if (mode === 'selection' && !inSelection(a)) return;
      add(a.href, 'link', a.textContent || a.getAttribute('title'));
    });
    if (mode === 'selection' && sel) {
      // Plain-text URLs inside the selection.
      for (const m of sel.toString().matchAll(/\b(?:https?|ftp):\/\/[^\s<>"'()]+/gi)) add(m[0].replace(/[.,;:!?]+$/, ''), 'link');
    }
  }
  if (mode === 'images') {
    document.querySelectorAll('img').forEach((img) => {
      add(largestFromSrcset(img.getAttribute('srcset')) || img.currentSrc || img.src || img.getAttribute('data-src'), 'image', img.alt);
      if (img.currentSrc && img.currentSrc !== img.src) add(img.src, 'image', img.alt);
    });
    document.querySelectorAll('picture source[srcset]').forEach((s) => add(largestFromSrcset(s.getAttribute('srcset')), 'image'));
    document.querySelectorAll<HTMLInputElement>('input[type=image][src]').forEach((i) => add(i.src, 'image', i.alt));
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      if (imageExt.test(a.pathname)) add(a.href, 'image', a.textContent);
    });
  }
  if (mode === 'videos') {
    document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => {
      const kind = m.tagName === 'AUDIO' ? 'audio' : 'video';
      if (m.currentSrc && !m.currentSrc.startsWith('blob:')) add(m.currentSrc, kind, document.title);
      if (m.getAttribute('src')) add(m.getAttribute('src'), kind, document.title);
      m.querySelectorAll('source[src]').forEach((s) => add(s.getAttribute('src'), kind, document.title));
    });
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      if (videoExt.test(a.pathname)) add(a.href, 'video', a.textContent);
      else if (audioExt.test(a.pathname)) add(a.href, 'audio', a.textContent);
    });
    document.querySelectorAll<HTMLEmbedElement | HTMLObjectElement>('embed[src], object[data]').forEach((e) => {
      const u = e.getAttribute('src') ?? e.getAttribute('data');
      if (u && videoExt.test(u)) add(u, 'video');
    });
  }
  return { pageUrl: location.href, title: document.title, items: out };
}

/** Collects in the tab (all frames, or one frame) and merges the results. */
export async function collectFromTab(tabId: number, mode: BatchKind, frameId?: number): Promise<CollectResult & { frames: number }> {
  const target: chrome.scripting.InjectionTarget = frameId !== undefined ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
  const results = await api.scripting.executeScript({ target, func: collectInPage, args: [mode] });
  const tab = await tabInfo(tabId);
  const merged: CollectResult = { pageUrl: tab?.url ?? '', title: tab?.title ?? '', items: [] };
  const seen = new Set<string>();
  let frames = 0;
  for (const r of results ?? []) {
    const res = r.result as CollectResult | undefined;
    if (!res) continue;
    frames++;
    if (r.frameId === 0 || !merged.pageUrl) {
      merged.pageUrl = res.pageUrl;
      merged.title = res.title;
    }
    for (const it of res.items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      merged.items.push(it);
    }
  }
  return { ...merged, frames };
}

/** Collect + send `batch`. Returns the number of items sent. */
export async function collectAndSend(tabId: number, mode: BatchKind, frameId?: number): Promise<number> {
  const activeTab = await tabInfo(tabId);
  if (isSocialMediaUrl(activeTab?.url ?? '') && mode !== 'selection') {
    if (!isSinglePostMediaUrl(activeTab?.url ?? '')) {
      throw new Error('For Instagram, TikTok, Facebook and X, open one post first. Page-wide collection is disabled to prevent unrelated media from being mixed in.');
    }
    await openPostMediaPicker(tabId);
    return 1;
  }
  const res = await collectFromTab(tabId, mode, frameId);
  if (!res.items.length) return 0;
  const tab = await tabInfo(tabId);
  const incognito = !!tab?.incognito;
  const cookiesFor = cookieCache(incognito);
  const items: BatchItem[] = await Promise.all(
    res.items.map(async (it) => {
      const filename = filenameFromUrl(it.url);
      return {
        url: it.url,
        referrer: res.pageUrl,
        kind: it.kind,
        ...(filename ? { filename } : {}),
        ...(it.text ? { text: it.text } : {}),
        cookies: await cookiesFor(it.url),
      };
    }),
  );
  const msg: BatchRequest = {
    type: 'batch',
    pageUrl: res.pageUrl,
    title: res.title,
    kind: mode,
    items,
    userAgent: userAgent(),
    incognito,
  };
  await native.request(msg, { timeoutMs: actionTimeout() });
  return items.length;
}
