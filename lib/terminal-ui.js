'use strict';

const readline = require('readline');
const { stripVTControlCharacters, format } = require('util');

const ESC = '\x1b[';
const RESET = `${ESC}0m${ESC}48;2;8;9;14m`;
const palette = { white: [235, 240, 250], dim: [135, 142, 158], purple: [124, 58, 237], cyan: [6, 182, 212], blue: [59, 130, 246], green: [74, 222, 128], yellow: [250, 204, 21], magenta: [217, 70, 239], red: [248, 113, 113] };
const progressColors = [[6, 182, 212], [59, 130, 246], [139, 92, 246]];
const ink = (name) => `${ESC}38;2;${(palette[name] || palette.white).join(';')}m`;
const clean = (text) => stripVTControlCharacters(String(text ?? '')
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
// pkg's Windows Node 18 runtime exits natively inside Intl.Segmenter.segment().
// Keep terminal editing independent of ICU: combine marks, variation selectors,
// emoji modifiers, ZWJ sequences and regional-indicator pairs in JavaScript.
function graphemes(text) {
  const result = [];
  let joinNext = false, regionalCount = 0;
  for (const ch of clean(text)) {
    const regional = /[\u{1f1e6}-\u{1f1ff}]/u.test(ch);
    const attached = /[\p{Mark}\u200d\ufe0f\u{1f3fb}-\u{1f3ff}]/u.test(ch);
    if (result.length && (attached || joinNext || (regional && regionalCount % 2))) result[result.length - 1] += ch;
    else result.push(ch);
    joinNext = ch === '\u200d';
    regionalCount = regional ? regionalCount + 1 : 0;
  }
  return result;
}
function graphemeWidth(ch) {
  if (/^[\p{Mark}\u200d\ufe0f]+$/u.test(ch)) return 0;
  return /\p{Extended_Pictographic}|[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{1f1e6}-\u{1f1ff}]/u.test(ch) ? 2 : 1;
}
const cellWidth = text => graphemes(text).reduce((sum, ch) => sum + graphemeWidth(ch), 0);
function clip(text, width) {
  let out = '', used = 0;
  for (const ch of graphemes(text)) {
    const size = graphemeWidth(ch);
    if (used + size > width) break;
    out += ch; used += size;
  }
  return out;
}
function wrap(text, width) {
  const lines = []; let line = '', used = 0;
  for (const ch of graphemes(text)) {
    const size = graphemeWidth(ch);
    if (used + size > width && line) { lines.push(line); line = ''; used = 0; }
    line += ch; used += size;
  }
  if (line) lines.push(line);
  return lines;
}
function gradient(text, phase = 0) {
  return graphemes(text).map((ch, i) => {
    const t = (Math.sin(i * 0.15 + phase) + 1) / 2;
    const rgb = palette.purple.map((c, n) => Math.round(c + (palette.cyan[n] - c) * t));
    return `${ESC}38;2;${rgb.join(';')}m${ch}`;
  }).join('') + RESET;
}
function movingGradient(text, phase = 0) {
  return [...text].map((ch, i) => {
    const position = (((i / 72 + phase * 0.12) % 1) + 1) % 1 * progressColors.length;
    const from = Math.floor(position);
    const mix = position - from;
    const start = progressColors[from];
    const end = progressColors[(from + 1) % progressColors.length];
    const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * mix));
    return `${ESC}38;2;${rgb.join(';')}m${ch}`;
  }).join('') + RESET;
}

const LOGO = [
  '███████╗███████╗██╗     ██╗   ██╗██╗  ██╗',
  '╚══███╔╝██╔════╝██║     ██║   ██║╚██╗██╔╝',
  '  ███╔╝ █████╗  ██║     ██║   ██║ ╚███╔╝ ',
  ' ███╔╝  ██╔══╝  ██║     ██║   ██║ ██╔██╗ ',
  '███████╗███████╗███████╗╚██████╔╝██╔╝ ██╗',
  '╚══════╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝',
];
const HOME = [
  ['download', 'DOWNLOAD', 'Paste a link, multiple links or a .txt file'],
  ['history', 'HISTORY', 'Review completed, cancelled and failed jobs'],
  ['library', 'SMART LIBRARY', 'Find files, sources and duplicate copies'],
  ['settings', 'SETTINGS', 'Connections, destination and batch queue'],
  ['open', 'OPEN DOWNLOADS', 'Open your download folder'],
  ['retry failed', 'RETRY FAILED', 'Retry failed and cancelled downloads'],
  ['upgrade', 'UPGRADE', 'Check and install a verified ZELUX-DL update'],
  ['help', 'COMMANDS', 'All commands, including yt-dlp updates'],
  ['exit', 'EXIT', 'Close ZELUX-DL'],
].map(([value, label, description]) => ({ value, label, description }));

class TerminalUI {
  constructor({ version, snapshot, input = process.stdin, output = process.stdout, motion = true, onCancel = () => { } }) {
    Object.assign(this, { version, snapshot, input, output, motion, onCancel });
    this.active = false;
    this.operation = null;
    this.state = { type: 'menu', title: 'DOWNLOAD MANAGER', options: HOME, selected: 0, home: true };
    this.selection = 0;
    this.logs = [];
    this.bars = [];
    this.frames = [];
    this.phase = 0;
    this.dirty = true;
    this.menuQueue = Promise.resolve();
    this.onKey = (str, key = {}) => this.handleKey(str, key);
    this.onResize = () => { this.frames = []; this.dirty = true; this.render(); };
    this.onExit = () => this.close();
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.wasRaw = Boolean(this.input.isRaw);
    this.wasPaused = this.input.isPaused();
    this.input.setRawMode(true);
    readline.emitKeypressEvents(this.input);
    this.input.on('keypress', this.onKey);
    this.input.resume();
    this.output.on('resize', this.onResize);
    process.once('exit', this.onExit);
    // Alternate buffer preserves the caller's scrollback. Never change system fonts.
    this.output.write(`${ESC}?1049h${ESC}?25l${ESC}?2004h${RESET}${ESC}2J`);
    if (this.motion) {
      this.state = { type: 'boot', frame: 0 };
      this.introPromise = this.playIntro();
    }
    this.timer = setInterval(() => {
      if (this.motion) { this.phase += 0.075; this.dirty = true; }
      if (this.operation) this.dirty = true;
      if (this.dirty) this.render();
    }, 100);
    this.render();
  }

  async playIntro() {
    const frames = 10;
    for (let frame = 0; frame < frames && this.state.type === 'boot'; frame++) {
      this.state.frame = frame;
      this.dirty = true;
      this.render();
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (this.state.type === 'boot') {
      this.state = { type: 'menu', title: 'DOWNLOAD MANAGER', options: HOME, selected: this.selection, home: true };
      this.dirty = true;
      this.render();
    }
  }

  close() {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.timer);
    this.input.removeListener('keypress', this.onKey);
    this.output.removeListener('resize', this.onResize);
    process.removeListener('exit', this.onExit);
    this.input.setRawMode(this.wasRaw);
    this.input.pause();
    this.output.write(`${ESC}0m${ESC}?2004l${ESC}?25h${ESC}?1049l`);
  }

  log(...args) {
    for (const line of format(...args).split(/\r?\n/)) {
      const text = clean(line).trim();
      if (text && !/^[─━═]+$/.test(text)) this.logs.push(text);
    }
    this.logs = this.logs.slice(-300);
    this.dirty = true;
  }

  beginBatch(urls) {
    this.batchView = {
      jobs: urls.map((url, index) => {
        let label = String(url);
        try {
          const parsed = new URL(url);
          label = `${parsed.hostname}${parsed.pathname}`;
        } catch (_) { /* Keep the original URL as a fallback label. */ }
        return { index, label, status: 'queued', logs: [], progress: null };
      }),
      focus: 0,
    };
    this.dirty = true;
  }

  startBatchItem(index) {
    const job = this.batchView?.jobs[index];
    if (!job) return;
    job.status = 'running';
    if (!this.batchView.jobs.some(item => item.status === 'running' && item.index === this.batchView.focus)) {
      this.batchView.focus = index;
    }
    this.dirty = true;
  }

  logBatch(index, ...args) {
    const job = this.batchView?.jobs[index];
    if (!job) return;
    for (const line of format(...args).split(/\r?\n/)) {
      const text = clean(line).trim();
      if (text && !/^[─━═]+$/.test(text)) job.logs.push(text);
    }
    job.logs = job.logs.slice(-100);
    this.dirty = true;
  }

  progressBatch(index, label) {
    const job = this.batchView?.jobs[index];
    if (!job) return this.progress(label);
    const record = { label: clean(label), total: 1, value: 0, payload: {}, stopped: false };
    job.progress = record;
    const update = (value, payload = {}) => {
      if (typeof value === 'object') payload = value;
      else record.value = value;
      record.payload = { ...record.payload, ...payload };
      this.dirty = true;
    };
    return {
      start: (total, value, payload) => { record.total = total; update(value, payload); },
      update,
      stop: () => { record.stopped = true; this.dirty = true; },
    };
  }

  markBatchItemFinalizing(index) {
    const job = this.batchView?.jobs[index];
    if (!job) return;
    job.status = 'finalizing';
    job.statusLabel = 'ดาวน์โหลดครบแล้ว · รอฝังปก';
    if (job.progress) {
      job.progress.total = 1;
      job.progress.value = 1;
      job.progress.stopped = false;
      job.progress.payload = { speed: 'Downloaded', downloaded: '100%', total: 'Complete', eta_formatted: '—' };
    }
    this.dirty = true;
  }

  updateBatchItem(index, label) {
    const job = this.batchView?.jobs[index];
    if (!job) return;
    job.status = 'finalizing';
    job.statusLabel = clean(label);
    this.batchView.focus = index;
    this.dirty = true;
  }

  finishBatchItem(index, result) {
    const batch = this.batchView;
    const job = batch?.jobs[index];
    if (!job) return;
    job.status = result?.cancelled ? 'cancelled' : result?.success ? 'completed' : 'failed';
    if (batch.focus === index) {
      const running = batch.jobs.find(item => ['running', 'finalizing'].includes(item.status));
      const queued = batch.jobs.find(item => item.status === 'queued');
      if (running) batch.focus = running.index;
      else if (queued) batch.focus = queued.index;
    }
    this.dirty = true;
  }

  endBatch() {
    this.batchView = null;
    this.dirty = true;
  }

  progress(label) {
    const record = { label: clean(label), total: 1, value: 0, payload: {}, stopped: false };
    this.bars.push(record);
    const update = (value, payload = {}) => {
      if (typeof value === 'object') payload = value;
      else record.value = value;
      record.payload = { ...record.payload, ...payload };
      this.dirty = true;
    };
    return {
      start: (total, value, payload) => { record.total = total; update(value, payload); },
      update,
      stop: () => { record.stopped = true; this.dirty = true; },
    };
  }

  async run(title, action, cancellable = true) {
    this.operation = { title, started: Date.now(), cancelled: false, cancellable };
    this.logs = []; this.bars = [];
    this.state = { type: 'operation', title };
    this.dirty = true; this.render();
    try { return await action(); }
    finally { this.operation = null; }
  }

  screen(state) {
    this.state = state;
    this.dirty = true;
    this.render();
    return new Promise(resolve => { this.resolve = resolve; });
  }

  home() {
    return this.screen({ type: 'menu', title: 'DOWNLOAD MANAGER', options: HOME, selected: this.selection, home: true, snapshot: this.snapshot() });
  }

  async choose(options, title) {
    // Batch media jobs can request menus concurrently; only one owns keyboard focus.
    const previous = this.menuQueue;
    let release;
    this.menuQueue = new Promise(resolve => { release = resolve; });
    await previous;
    const oldState = this.state;
    try {
      if (this.operation?.cancelled) throw new Error('CANCELLED');
      const result = await this.screen({ type: 'menu', title, options, selected: 0 });
      if (result === null) throw new Error('CANCELLED');
      return result;
    } finally {
      this.state = oldState; this.dirty = true; release();
    }
  }

  ask(title, hint = 'Paste URLs or type a command, then press Enter', value = '') {
    return this.screen({ type: 'input', title, hint, text: value, cursor: graphemes(value).length });
  }

  page(title, lines) {
    return this.screen({ type: 'page', title, lines: lines.map(line => {
      if (line && typeof line === 'object' && !Array.isArray(line)) {
        return {
          label: clean(line.label),
          description: clean(line.description),
          color: Object.hasOwn(palette, line.color) ? line.color : 'cyan',
        };
      }
      return clean(line);
    }), offset: 0 });
  }

  finish(value) {
    const resolve = this.resolve;
    this.resolve = null;
    if (this.state.home) this.selection = this.state.selected;
    resolve?.(value);
  }

  handleKey(str, key) {
    if (key.sequence === '\x1b[200~') { this.pasting = true; return; }
    if (key.sequence === '\x1b[201~') { this.pasting = false; return; }
    const s = this.state;
    if (s.type === 'boot') {
      // Any input skips the short intro; process the same key on the home screen.
      this.state = { type: 'menu', title: 'DOWNLOAD MANAGER', options: HOME, selected: this.selection, home: true };
    }
    const current = this.state;
    const escape = key.name === 'escape' || key.sequence === '\x1b[27;1;27~' || (key.ctrl && key.name === 'c');
    if (escape) {
      if (this.operation && !this.operation.cancellable) return;
      if (this.operation) {
        this.operation.cancelled = true;
        this.onCancel(); this.log('Cancelling... waiting for file cleanup.');
      }
      this.finish(current.home ? 'exit' : null);
      return;
    }
    if ((this.output.columns || 90) < 60 || (this.output.rows || 32) < 26) return;
    if (current.type === 'menu') {
      if (key.name === 'up') current.selected = (current.selected + current.options.length - 1) % current.options.length;
      else if (key.name === 'down' || key.name === 'tab') current.selected = (current.selected + 1) % current.options.length;
      else if (key.name === 'return' && !this.pasting) this.finish(current.options[current.selected].value);
      else if (current.home && str && !key.ctrl && !key.meta && !key.sequence?.startsWith('\x1b')) {
        this.state = { type: 'input', title: 'LINKS / COMMAND', hint: 'Enter to submit  /  Esc to return', text: clean(str), cursor: graphemes(str).length };
      }
    } else if (current.type === 'input') {
      const chars = graphemes(current.text);
      if (key.name === 'return' && !this.pasting) this.finish(current.text.trim());
      else if (key.name === 'left') current.cursor = Math.max(0, current.cursor - 1);
      else if (key.name === 'right') current.cursor = Math.min(chars.length, current.cursor + 1);
      else if (key.name === 'home' || (key.ctrl && key.name === 'a')) current.cursor = 0;
      else if (key.name === 'end' || (key.ctrl && key.name === 'e')) current.cursor = chars.length;
      else if (key.ctrl && key.name === 'u') { chars.splice(0, current.cursor); current.cursor = 0; }
      else if (key.name === 'backspace' && current.cursor > 0) chars.splice(--current.cursor, 1);
      else if (key.name === 'delete') chars.splice(current.cursor, 1);
      else if (str && !key.ctrl && !key.meta && !key.sequence?.startsWith('\x1b') && current.text.length < 32768) {
        const inserted = graphemes(str.replace(/[\r\n\t]/g, ' '));
        chars.splice(current.cursor, 0, ...inserted); current.cursor += inserted.length;
      }
      current.text = chars.join('');
      current.cursor = Math.min(current.cursor, graphemes(current.text).length);
    } else if (current.type === 'page') {
      if (key.name === 'up') current.offset = Math.max(0, current.offset - 1);
      else if (key.name === 'down') current.offset = Math.min(current.maxOffset || 0, current.offset + 1);
      else if (key.name === 'pagedown') current.offset = Math.min(current.maxOffset || 0, current.offset + 8);
      else if (key.name === 'pageup') current.offset = Math.max(0, current.offset - 8);
      else if (key.name === 'return') this.finish(null);
    }
    this.dirty = true;
  }

  buildFrame(columns, rows) {
    const width = Math.max(1, Math.min(90, columns - 1));
    const height = Math.max(1, Math.min(32, rows - 1));
    const lines = Array.from({ length: height }, () => []);
    const put = (x, y, text, color = 'white', special = null) => {
      if (y < 0 || y >= height || x < 0 || x >= width) return;
      const clipped = clip(text, width - x);
      lines[y].push({ x, text: special ? special(clipped) : ink(color) + clipped + RESET });
    };
    const center = (y, text, color, special) => put(Math.max(0, Math.floor((width - cellWidth(text)) / 2)), y, text, color, special);
    const box = (x, y, w, h) => {
      put(x, y, '╭' + '─'.repeat(w - 2) + '╮', 'purple');
      for (let i = 1; i < h - 1; i++) { put(x, y + i, '│', 'purple'); put(x + w - 1, y + i, '│', 'purple'); }
      put(x, y + h - 1, '╰' + '─'.repeat(w - 2) + '╯', 'purple');
    };
    if (columns < 60 || rows < 26) {
      center(1, 'ZELUX-DL', 'cyan');
      put(1, 3, 'Enlarge terminal to 60 x 26 or more.', 'white');
      put(1, 5, 'Esc: back / cancel   Ctrl+C: exit', 'dim');
      return { lines, width, height };
    }
    const s = this.state;
    if (s.type === 'boot') {
      const frame = s.frame || 0;
      const glitches = ['░', '▒', '▓', '█', '╳', '╱', '╲', '·'];
      LOGO.forEach((line, i) => {
        const reveal = Math.max(0, Math.min(line.length, Math.floor((frame - 2 - i * 0.45) * line.length / 4)));
        const tail = [...line.slice(reveal)].map((ch, n) => ch === ' ' ? ' ' : glitches[(n * 3 + i * 5 + frame) % glitches.length]).join('');
        const shown = line.slice(0, reveal) + (frame < 9 ? tail : '');
        if (shown) center(i + 1, shown, 'purple', text => movingGradient(text, this.phase + frame * 0.15));
      });
      center(8, `Z E L U X  /  v${this.version}`, 'dim');
      const bootLines = ['> ZELUX-DL / TERMINAL START', '> MULTI-SOURCE DOWNLOAD MANAGER', '> PRESS ANY KEY TO SKIP'];
      bootLines.forEach((line, i) => { if (frame >= i) center(11 + i, line, i === 2 ? 'dim' : 'cyan'); });
      const barWidth = Math.min(30, width - 20);
      const sweep = Math.floor((frame % 8) / 7 * Math.max(0, barWidth - 5));
      center(16, '─'.repeat(sweep) + '━'.repeat(Math.min(5, barWidth - sweep)) + '─'.repeat(Math.max(0, barWidth - sweep - 5)), 'cyan', text => movingGradient(text, this.phase));
      return { lines, width, height };
    }
    LOGO.forEach((line, i) => center(i + 1, line, 'purple', text => gradient(text, this.phase)));
    center(8, `D O W N L O A D   M A N A G E R   /   v${this.version}`, 'dim');
    const left = 4, inner = width - 8;
    center(10, clip(s.title, width - 8), 'cyan');
    if (s.type === 'menu') {
      const w = Math.min(48, width - 12), x = Math.floor((width - w) / 2);
      const visible = Math.min(s.options.length, Math.max(4, height - 19));
      const start = Math.max(0, s.selected - visible + 1);
      box(x, 11, w, visible + 2);
      s.options.slice(start, start + visible).forEach((item, i) => {
        const selected = start + i === s.selected;
        const text = clip(`${selected ? '›' : ' '}  ${item.label}`, w - 6).padEnd(w - 6);
        put(x + 3, 12 + i, text, selected ? 'white' : 'dim', selected ? t => `${ESC}48;2;45;26;78m${ink('white')}${t}${RESET}` : null);
      });
      center(height - 5, clip(s.options[s.selected]?.description || '↑ / ↓ Select   Enter Confirm   Esc Cancel', inner), 'dim');
      if (s.home) {
        const snap = s.snapshot || this.snapshot();
        // Keep the destination beside the menu it describes, not down in the footer.
        put(x, 13 + visible, clip(`Save to: ${snap.directory}`, w - 1), 'dim');
        put(x, 14 + visible, clip(`Cookies: ${snap.cookiesFile || 'cookies.txt'} · ${snap.cookiesReady ? 'ready' : 'empty'}`, w - 1), 'dim');
        center(height - 4, `${snap.completed} completed  ·  ${snap.failed} failed  ·  ${snap.connections} connections configured`, 'dim');
      }
      center(height - 1, s.home ? '↑ ↓ Select   Enter Confirm   Type / paste a URL   Esc Exit' : '↑ ↓ Select   Enter Confirm   Esc Back', 'cyan');
    } else if (s.type === 'input') {
      box(left, 12, inner, 5);
      const chars = graphemes(s.text);
      let before = '', used = 0;
      for (let i = s.cursor - 1; i >= 0; i--) {
        used += graphemeWidth(chars[i]);
        if (used > inner - 7) break;
        before = chars[i] + before;
      }
      const after = chars.slice(s.cursor).join('');
      put(left + 2, 14, '› ' + clip(before + after, inner - 5), 'white');
      // Inverse character is a stable input caret; the real cursor stays hidden.
      put(left + 4 + cellWidth(before), 14, chars[s.cursor] || ' ', 'white', t => `${ESC}7m${t}${RESET}`);
      put(left, 19, clip(s.hint, inner), 'dim');
      put(left, 21, `${chars.length} characters  ·  Ctrl+U clears input`, 'dim');
      center(height - 1, 'Enter Submit   Esc Back   ← → Edit', 'cyan');
    } else if (s.type === 'page') {
      const contentWidth = inner - 4;
      const labelWidth = Math.min(20, Math.max(14, Math.floor(contentWidth * 0.3)));
      const allLines = s.lines.flatMap(line => {
        if (typeof line === 'string') return (line ? wrap(line, contentWidth) : ['']).map(text => ({ text }));
        const descriptionWidth = Math.max(1, contentWidth - labelWidth - 2);
        const descriptions = wrap(line.description, descriptionWidth);
        return (descriptions.length ? descriptions : ['']).map((text, index) => ({
          label: index === 0 ? clip(line.label, labelWidth) : '',
          description: text,
          color: line.color,
        }));
      });
      s.maxOffset = Math.max(0, allLines.length - (height - 15));
      s.offset = Math.min(s.offset, s.maxOffset);
      const content = allLines.slice(s.offset);
      box(left, 11, inner, height - 13);
      content.slice(0, height - 15).forEach((line, i) => {
        if (line.label) {
          put(left + 2, 12 + i, line.label.padEnd(labelWidth), line.color);
          put(left + 2 + labelWidth + 2, 12 + i, line.description, 'white');
        } else {
          put(left + 2, 12 + i, line.text ?? line.description, 'white');
        }
      });
      center(height - 1, '↑ ↓ Scroll   PgUp PgDn   Enter / Esc Back', 'cyan');
    } else {
      if (this.batchView) {
        const { jobs, focus } = this.batchView;
        const job = jobs[focus] || jobs[0];
      const done = jobs.filter(item => ['completed', 'failed', 'cancelled'].includes(item.status)).length;
      const downloaded = jobs.filter(item => ['finalizing', 'completed'].includes(item.status)).length;
        const failed = jobs.filter(item => item.status === 'failed').length;
        let y = 12;
        put(left, y++, `LINK ${job.index + 1}/${jobs.length}   ·   ${downloaded} downloaded   ·   ${done} finalized${failed ? `   ·   ${failed} failed` : ''}`, 'cyan');
        put(left, y++, clip(job.progress?.label || job.label, inner), 'white');
        put(left, y++, job.status === 'queued' ? 'Waiting in queue…' : job.statusLabel || 'Focused download', 'dim');
        const bar = job.progress;
        if (bar) {
          const p = bar.payload;
          const progress = Math.max(0, Math.min(1, bar.value / (bar.total || 1)));
          const indeterminate = p.indeterminate || bar.stopped;
          const progressLabel = indeterminate ? 'LIVE' : `${(progress * 100).toFixed(1)}%`;
          const size = inner - 10;
          const pulseSize = Math.min(12, size);
          const pulsePosition = Math.round((0.5 + Math.sin(this.phase * 1.5) / 2) * (size - pulseSize));
          const filled = indeterminate ? 0 : Math.round(size * progress);
          const moving = indeterminate ? pulseSize : filled;
          if (indeterminate) put(left, y, '─'.repeat(pulsePosition), 'dim');
          if (moving) put(left + (indeterminate ? pulsePosition : 0), y, '━'.repeat(moving), 'white', text => movingGradient(text, this.phase));
          const remainderStart = indeterminate ? pulsePosition + pulseSize : filled;
          put(left + remainderStart, y, '─'.repeat(size - remainderStart), 'dim');
          put(left + size + 2, y++, progressLabel, 'cyan');
          put(left, y++, clip(`${p.speed || 'Preparing...'}  |  ${p.downloaded || '0 B'} / ${p.total || '?'}  |  ${p.eta_formatted || p.eta || '--:--'} ETA`, inner), 'dim');
        } else {
          put(left, y++, 'Preparing media details…', 'dim');
        }
        const available = Math.max(1, height - y - 3);
        const logLines = job.logs.slice(-available).flatMap(line => wrap(line, inner));
        logLines.slice(-available).forEach((line, i) => put(left, y + 1 + i, line, 'dim'));
      } else {
      const active = this.bars.filter(bar => !bar.stopped);
      const bars = (active.length ? active : this.bars.slice(-2)).slice(0, Math.max(1, Math.min(3, Math.floor((height - 17) / 3))));
      let y = 12;
      for (const bar of bars) {
        const p = bar.payload;
        const progress = Math.max(0, Math.min(1, bar.value / (bar.total || 1)));
        const label = p.indeterminate ? 'LIVE' : `${(progress * 100).toFixed(1)}%`;
        put(left, y++, clip(`${bar.label}${p.connections ? `  [${p.connections}x]` : ''}`, inner - 10), 'white');
        const size = inner - 10;
        const pulseSize = Math.min(12, size);
        const pulsePosition = Math.round((0.5 + Math.sin(this.phase * 1.5) / 2) * (size - pulseSize));
        const filled = p.indeterminate ? 0 : Math.round(size * progress);
        const moving = p.indeterminate ? pulseSize : filled;
        if (p.indeterminate) put(left, y, '─'.repeat(pulsePosition), 'dim');
        if (moving) put(left + (p.indeterminate ? pulsePosition : 0), y, '━'.repeat(moving), 'white', text => movingGradient(text, this.phase));
        const remainderStart = p.indeterminate ? pulsePosition + pulseSize : filled;
        put(left + remainderStart, y, '─'.repeat(size - remainderStart), 'dim');
        put(left + size + 2, y++, label, 'cyan');
        put(left, y++, clip(`${p.speed || 'Preparing...'}  |  ${p.downloaded || '0 B'} / ${p.total || '?'}  |  ${p.eta_formatted || p.eta || '--:--'} ETA`, inner), 'dim');
      }
      if (active.length > bars.length) put(left, y++, `+ ${active.length - bars.length} other active downloads`, 'dim');
      const available = Math.max(1, height - y - 3);
      const logLines = this.logs.slice(-available).flatMap(line => wrap(line, inner));
      logLines.slice(-available).forEach((line, i) => put(left, y + 1 + i, line, 'dim'));
      }
      const elapsed = this.operation ? Math.floor((Date.now() - this.operation.started) / 1000) : 0;
      center(height - 1, `${this.operation?.cancelled ? 'CANCELLING' : 'RUNNING'}  ·  ${elapsed}s elapsed  ·  ${this.operation?.cancellable ? 'Esc / Ctrl+C Cancel' : 'Please wait'}`, 'cyan');
    }
    return { lines, width, height };
  }

  render() {
    if (!this.active) return;
    this.dirty = false;
    const columns = this.output.columns || 90, rows = this.output.rows || 32;
    const frame = this.buildFrame(columns, rows);
    const x = Math.max(0, Math.floor((columns - frame.width) / 2));
    const y = Math.max(0, Math.floor((rows - frame.height) / 2));
    const signature = `${columns}:${rows}`;
    let out = '';
    if (signature !== this.signature) { this.signature = signature; this.frames = []; out += `${ESC}2J`; }
    frame.lines.forEach((parts, i) => {
      const line = parts.map(part => `${ESC}${y + i + 1};${x + part.x + 1}H${part.text}`).join('');
      if (this.frames[i] !== line) {
        out += `${ESC}${y + i + 1};1H${RESET}${ESC}2K` + line;
        this.frames[i] = line;
      }
    });
    if (out) this.output.write(out);
  }
}

module.exports = { TerminalUI, clean, clip, cellWidth, wrap, HOME };
