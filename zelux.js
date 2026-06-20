#!/usr/bin/env node

/* ════════════════════════════════════════════════════
   ZELUX-DL v2 — Lightning Fast Terminal File Downloader
   ════════════════════════════════════════════════════ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const readline = require('readline');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ── App Version & Update Config ──
const APP_VERSION = '1.0.0';
const GITHUB_REPO = 'SMOKEx2/Zelux-DL';


// Determine the base directory where config, downloads, and binaries should live.
// If packaged by pkg, use the directory containing the executable, otherwise use the directory of the script.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

process.on('uncaughtException', err => {
  try {
    require('fs').writeFileSync(require('path').join(BASE_DIR, 'error.log'), err.stack);
  } catch (e) { }
  process.exit(1);
});

// ── Config ──
let DOWNLOADS_DIR = path.join(BASE_DIR, 'downloads');
let MAX_REDIRECTS = 15;
let TIMEOUT_MS = 60000;
let MAX_RETRIES = 3;
let NUM_CONNECTIONS = 4;

function loadConfig() {
  const configPath = path.join(BASE_DIR, 'config.json');
  const defaults = {
    DOWNLOADS_DIR: "downloads",
    MAX_REDIRECTS: 15,
    TIMEOUT_MS: 60000,
    MAX_RETRIES: 3,
    NUM_CONNECTIONS: 16
  };

  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (userConfig.DOWNLOADS_DIR) {
        DOWNLOADS_DIR = path.isAbsolute(userConfig.DOWNLOADS_DIR) ? userConfig.DOWNLOADS_DIR : path.join(BASE_DIR, userConfig.DOWNLOADS_DIR);
      }
      if (userConfig.MAX_REDIRECTS) MAX_REDIRECTS = userConfig.MAX_REDIRECTS;
      if (userConfig.TIMEOUT_MS) TIMEOUT_MS = userConfig.TIMEOUT_MS;
      if (userConfig.MAX_RETRIES) MAX_RETRIES = userConfig.MAX_RETRIES;
      if (userConfig.NUM_CONNECTIONS) NUM_CONNECTIONS = userConfig.NUM_CONNECTIONS;
    } catch (e) {
      console.log(chalk.yellow('⚠️ ไม่สามารถอ่าน config.json ได้ จะใช้ค่าเริ่มต้นแทน'));
    }
  } else {
    try {
      fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf8');
    } catch (e) { }
  }

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
}

loadConfig();

// Helper to auto-load cookies.txt if available
function getCookiesArgs() {
  const cookiesPath = path.join(BASE_DIR, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    return { str: ` --cookies "${cookiesPath}"`, arr: ['--cookies', cookiesPath] };
  }
  return { str: '', arr: [] };
}

// ── Chalk Helpers ──
const brand = chalk.hex('#a855f7').bold;
const accent = chalk.hex('#6366f1');
const success = chalk.hex('#10b981');
const warning = chalk.hex('#f59e0b');
const error = chalk.hex('#ef4444');
const dim = chalk.gray;
const info = chalk.hex('#3b82f6');
const white = chalk.white.bold;
const separator = dim('─'.repeat(51));

// ═══════════════════════════════════════════
//  ANSI SHADOW ASCII ART LOGO (no frame)
// ═══════════════════════════════════════════
const LOGO = [
  '·▄▄▄▄•▄▄▄ .▄▄▌  ▄• ▄▌▐▄• ▄ ',
  '▪▀·.█▌▀▄.▀·██•  █▪██▌ █▌█▌▪',
  '▄█▀▀▀•▐▀▀▪▄██▪  █▌▐█▌ ·██· ',
  '█▌▪▄█▀▐█▄▄▌▐█▌▐▌▐█▄█▌▪▐█·█▌',
  '·▀▀▀ • ▀▀▀ .▀▀▀  ▀▀▀ •▀▀ ▀▀'
];
const LOGO_PADDING = '           '; // 10 spaces to center the logo

// ═══════════════════════════════════════════
//  RAINBOW ENGINE
// ═══════════════════════════════════════════

function rainbowChar(ch, hue) {
  if (ch === ' ') return ' ';
  return chalk.hsl(hue % 360, 100, 65)(ch);
}

function rainbowLine(text, hueOffset) {
  let out = '';
  let ci = 0;
  for (const ch of text) {
    if (ch === ' ') {
      out += ' ';
    } else {
      out += rainbowChar(ch, ci * 5 + hueOffset);
      ci++;
    }
  }
  return out;
}

function rainbowBar(filled, empty) {
  const hueOff = Math.floor(Date.now() / 6) % 360;
  let bar = '';
  for (let i = 0; i < filled; i++) {
    bar += chalk.hsl((i * 8 + hueOff) % 360, 100, 55)('█');
  }
  for (let i = 0; i < empty; i++) {
    bar += chalk.hsl((i * 8 + hueOff + filled * 8) % 360, 15, 18)('░');
  }
  return bar;
}

// ═══════════════════════════════════════════
//  ANIMATED INTRO
// ═══════════════════════════════════════════

async function animatedIntro() {
  const rows = LOGO.length;
  const cols = process.stdout.columns || 80;

  process.stdout.write('\x1b[?25l'); // hide cursor
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear screen and scrollback buffer
  console.log(); // row 1 blank

  // print placeholder lines so they exist
  for (let r = 0; r < rows; r++) console.log();
  console.log(); // blank after logo

  const logoStartRow = 2; // 1-indexed, after blank line
  const totalFrames = 60;

  for (let f = 0; f < totalFrames; f++) {
    const hueOff = f * 8;

    // reposition cursor to logo start
    process.stdout.write(`\x1b[${logoStartRow};1H`);

    for (let r = 0; r < rows; r++) {
      const lineHue = hueOff + r * 20;
      const colored = LOGO_PADDING + rainbowLine(LOGO[r], lineHue);
      // write + clear rest of line
      process.stdout.write(colored + '\x1b[K\n');
    }

    await sleep(33); // ~30fps
  }

  process.stdout.write('\x1b[?25h'); // show cursor
}

let currentView = 'default';

function renderScreen() {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear screen and scrollback buffer
  console.log();
  const hue = Math.floor(Date.now() / 5) % 360;
  for (let r = 0; r < LOGO.length; r++) {
    console.log(LOGO_PADDING + rainbowLine(LOGO[r], hue + r * 20));
  }
  console.log();

  switch (currentView) {
    case 'default':
      const displayDownloadsDir = DOWNLOADS_DIR.length > 22 ? '...' + DOWNLOADS_DIR.substring(DOWNLOADS_DIR.length - 19) : DOWNLOADS_DIR;
      console.log('       ' + chalk.hex('#38bdf8')('📁 โฟลเดอร์: ') + chalk.yellow.bold(displayDownloadsDir));
      console.log('       ' + chalk.hex('#fbbf24')('💡 Tip:') + dim(' วางหลาย URL เพื่อโหลด ') + chalk.green.bold('Batch'));
      console.log('       ' + chalk.hex('#fbbf24')('💡 Tip:') + dim(' พิมพ์ ') + chalk.magenta.bold('help') + dim(' เพื่อดูคำสั่งทั้งหมด'));
      const filesCount = fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR).filter(f => fs.statSync(path.join(DOWNLOADS_DIR, f)).isFile()).length : 0;
      console.log('       ' + chalk.hex('#a855f7')('📊 ประวัติ:') + dim(' ดาวน์โหลดสำเร็จแล้ว ') + chalk.magenta.bold(filesCount) + dim(' ไฟล์'));
      break;

    case 'help':
      console.log(chalk.hex('#f472b6').bold('    📖 คำสั่งที่ใช้ได้:'));
      console.log();
      console.log('    ' + chalk.hex('#60a5fa').bold('<URL>') + '             ' + chalk.white('วางลิงก์ดาวน์โหลดไฟล์'));
      console.log('    ' + chalk.hex('#34d399').bold('URLs...') + '           ' + chalk.white('วางหลายลิงก์โหลด Batch'));
      console.log('    ' + chalk.hex('#fbbf24').bold('list') + '              ' + chalk.white('ดูรายการไฟล์ที่โหลดแล้ว'));
      console.log('    ' + chalk.hex('#a78bfa').bold('clear') + '             ' + chalk.white('ล้างหน้าจอ'));
      console.log('    ' + chalk.hex('#2dd4bf').bold('open') + '              ' + chalk.white('เปิดโฟลเดอร์ downloads'));
      console.log('    ' + chalk.hex('#f59e0b').bold('update') + '            ' + chalk.white('อัปเดตyt-dlpให้เป็นเวอร์ชันล่าสุด'));
      console.log('    ' + chalk.hex('#10b981').bold('upgrade') + '           ' + chalk.white('อัปเดต ZELUX-DL ตัวเต็ม'));
      console.log('    ' + chalk.hex('#f472b6').bold('help') + '              ' + chalk.white('แสดงคำสั่งทั้งหมด'));
      console.log('    ' + chalk.hex('#f87171').bold('exit') + '              ' + chalk.white('ออกจากโปรแกรม'));
      console.log();
      console.log(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;

    case 'list':
      const files = fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR).filter(f => fs.statSync(path.join(DOWNLOADS_DIR, f)).isFile()) : [];
      if (files.length === 0) {
        console.log('    ' + chalk.hex('#94a3b8')('📭 ยังไม่มีไฟล์ที่ดาวน์โหลด'));
      } else {
        console.log('    ' + chalk.hex('#38bdf8').bold(`📁 ไฟล์ที่โหลดแล้ว (${files.length} ไฟล์):`));
        console.log();
        let tot = 0;
        const limit = 8;
        const showFiles = files.slice(0, limit);
        showFiles.forEach((f, i) => {
          const st = fs.statSync(path.join(DOWNLOADS_DIR, f));
          console.log(`    ${chalk.hex('#818cf8')((i + 1).toString().padStart(2) + '.')} ${chalk.cyan(f.length > 20 ? f.substring(0, 17) + '...' : f)}  ${chalk.yellow(formatBytes(st.size).padStart(9))}`);
        });

        files.forEach(f => {
          const st = fs.statSync(path.join(DOWNLOADS_DIR, f));
          tot += st.size;
        });

        if (files.length > limit) {
          console.log(`    ${dim('...')} และอีก ${files.length - limit} ไฟล์`);
        }
        console.log();
        console.log('    ' + chalk.hex('#fbbf24')('ขนาดรวม: ') + chalk.yellow.bold(formatBytes(tot)));
      }
      console.log();
      console.log(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;

    case 'open':
      console.log('    ' + success('✓') + chalk.hex('#34d399').bold(' เปิดโฟลเดอร์ downloads สำเร็จ!'));
      console.log();
      console.log(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;

    case 'download':
      console.log('    ' + info('⚡') + chalk.hex('#60a5fa').bold(' กำลังดำเนินการดาวน์โหลด...'));
      break;

    case 'update':
      console.log('    ' + info('⚡') + chalk.hex('#60a5fa').bold(' กำลังดำเนินการตรวจสอบอัปเดต...'));
      break;

    case 'download-done':
      // This is shown as a footer when the downloads complete.
      console.log(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;
  }

  console.log();
  console.log('    ' + rainbowLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', Date.now() / 5));
  console.log();
}

// ═══════════════════════════════════════════
//  HTTP ENGINE
// ═══════════════════════════════════════════

function buildHeaders(url) {
  let p;
  try { p = new URL(url); } catch (e) { p = null; }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...(p ? { 'Referer': `${p.protocol}//${p.host}/` } : {}),
  };
}

function extractFilename(urlStr, headers) {
  const cd = headers['content-disposition'];
  if (cd) {
    const m1 = cd.match(/filename\*=(?:UTF-8''|utf-8'')(.+)/i);
    if (m1) return decodeURIComponent(m1[1].replace(/['"]/g, ''));
    const m2 = cd.match(/filename=["']?([^"';\n]+)/i);
    if (m2) return m2[1].trim();
  }
  try {
    const u = new URL(urlStr);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length > 0) {
      const last = decodeURIComponent(segs[segs.length - 1]);
      if (last && last.includes('.')) return last;
    }
  } catch (e) { }
  return `download_${Date.now()}`;
}

function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
}

function formatSpeed(bps) {
  if (!bps || bps === 0) return '0 B/s';
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bps) / Math.log(1024));
  return (bps / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

function formatETA(s) {
  if (!s || !isFinite(s) || s <= 0) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m > 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getUniqueFilePath(dir, filename) {
  let fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) return fp;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let c = 1;
  while (fs.existsSync(fp)) { fp = path.join(dir, `${base} (${c})${ext}`); c++; }
  return fp;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calculateSHA256(fp) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(fp);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

const activeRequests = new Set();

function abortAllDownloads() {
  for (const item of activeRequests) {
    try {
      item.destroy();
    } catch (e) { }
  }
  activeRequests.clear();
}

// ── Download Cancel Controller ──
class CancelController {
  constructor() {
    this.cancelled = false;
    this.childProcess = null;
    this._onKey = null;
  }

  // Start listening for Escape/Ctrl+C during download
  startListening() {
    this.cancelled = false;
    const stdin = process.stdin;
    if (!stdin.isTTY || !stdin.setRawMode) return;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    this._onKey = (key) => {
      // Escape key = \x1b (without [ following = standalone Escape)
      // Ctrl+C = \x03
      if (key === '\x1b' || key === '\x03') {
        this.cancel();
      }
    };
    stdin.on('data', this._onKey);
  }

  // Stop listening
  stopListening() {
    const stdin = process.stdin;
    if (this._onKey) {
      stdin.removeListener('data', this._onKey);
      this._onKey = null;
    }
    // Do NOT call stdin.pause() or stdin.setRawMode(false) here!
    // Toggling raw mode and pausing the stream corrupts the Windows console 
    // input buffer, which causes the "Double Enter" bug when readline takes over.
  }

  // Cancel the active download
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;

    // Kill yt-dlp child process if active
    if (this.childProcess) {
      try {
        if (process.platform === 'win32') {
          // On Windows, use taskkill to kill the process tree
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${this.childProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
          this.childProcess.kill('SIGKILL');
        }
      } catch (e) { }
      this.childProcess = null;
    }

    // Abort all HTTP connections
    abortAllDownloads();
  }
}

const cancelCtrl = new CancelController();

// ── HTTP request with redirect ──
function httpRequest(rawUrl, extraHeaders = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount >= MAX_REDIRECTS) return reject(new Error('Redirect มากเกินไป'));
    let p;
    try { p = new URL(rawUrl); } catch (e) { return reject(new Error('URL ไม่ถูกต้อง')); }
    const client = p.protocol === 'https:' ? https : http;
    const headers = { ...buildHeaders(rawUrl), ...extraHeaders };
    const opts = {
      hostname: p.hostname,
      port: p.port || (p.protocol === 'https:' ? 443 : 80),
      path: p.pathname + p.search,
      method: 'GET',
      headers,
      timeout: TIMEOUT_MS,
      rejectUnauthorized: false,
    };
    const req = client.request(opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redir = res.headers.location;
        if (!redir.startsWith('http')) redir = new URL(redir, rawUrl).href;
        res.destroy();
        activeRequests.delete(req);
        httpRequest(redir, extraHeaders, redirectCount + 1).then(resolve).catch(reject);
      } else {
        activeRequests.add(res);
        activeRequests.delete(req);
        resolve({ res, finalUrl: rawUrl });
      }
    });
    activeRequests.add(req);
    req.on('error', (err) => {
      activeRequests.delete(req);
      reject(err);
    });
    req.on('timeout', () => {
      activeRequests.delete(req);
      req.destroy();
      reject(new Error('หมดเวลาเชื่อมต่อ'));
    });
    req.end();
  });
}

// ── Probe file info ──
async function probeFileInfo(url, retryCount = 0) {
  try {
    const { res, finalUrl } = await httpRequest(url, { 'Range': 'bytes=0-0' });
    res.destroy();

    if (res.statusCode >= 400) {
      const err = new Error(`HTTP ${res.statusCode}`);
      err.statusCode = res.statusCode;
      throw err;
    }

    const acceptRanges = res.statusCode === 206 || res.headers['accept-ranges'] === 'bytes';
    let totalSize = 0;
    if (res.statusCode === 206 && res.headers['content-range']) {
      const m = res.headers['content-range'].match(/\/(\d+)/);
      if (m) totalSize = parseInt(m[1], 10);
    } else {
      totalSize = parseInt(res.headers['content-length'], 10) || 0;
    }
    return { finalUrl, acceptRanges, totalSize, filename: extractFilename(finalUrl, res.headers), contentType: res.headers['content-type'] || 'unknown' };
  } catch (err) {
    const isTemporary = err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode < 600) || !err.statusCode;
    if (isTemporary && retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
      console.log(`  ${warning('⚠')} เชื่อมต่อล้มเหลว (${err.message}) — กำลังลองใหม่ใน ${(delay / 1000).toFixed(1)} วินาที... (${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return probeFileInfo(url, retryCount + 1);
    }
    throw err;
  }
}

// ── Download a range to file ──
function downloadRange(url, start, end, dest, onData, retryCount = 0, showRetryLogs = true) {
  return new Promise((resolve, reject) => {
    if (cancelCtrl.cancelled) return reject(new Error('CANCELLED'));

    const extra = {};
    if (start !== undefined && end !== undefined) extra['Range'] = `bytes=${start}-${end}`;

    httpRequest(url, extra).then(({ res }) => {
      if (cancelCtrl.cancelled) return reject(new Error('CANCELLED'));
      if (res.statusCode >= 400) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        throw err;
      }
      const ws = fs.createWriteStream(dest);
      res.on('data', chunk => {
        if (cancelCtrl.cancelled) { ws.destroy(); res.destroy(); reject(new Error('CANCELLED')); return; }
        onData(chunk.length);
      });
      res.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      res.on('error', err => { ws.destroy(); reject(err); });
    }).catch(async (err) => {
      if (cancelCtrl.cancelled) return reject(new Error('CANCELLED'));
      const isTemporary = err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode < 600) || !err.statusCode;
      if (isTemporary && retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
        if (showRetryLogs) {
          process.stdout.write('\r\x1b[K');
          console.log(`  ${warning('⚠')} ดาวน์โหลดขัดข้อง (${err.message}) — กำลังลองใหม่ใน ${(delay / 1000).toFixed(1)} วินาที... (${retryCount + 1}/${MAX_RETRIES})`);
        }
        await sleep(delay);
        if (cancelCtrl.cancelled) return reject(new Error('CANCELLED'));
        downloadRange(url, start, end, dest, onData, retryCount + 1, showRetryLogs).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// ── Merge chunks for multi-connection ──
async function mergeChunks(fp, n) {
  const ws = fs.createWriteStream(fp);
  for (let i = 0; i < n; i++) {
    const cp = `${fp}.part${i}`;
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(cp);
      rs.pipe(ws, { end: false });
      rs.on('end', () => {
        try { fs.unlinkSync(cp); } catch (e) { }
        resolve();
      });
      rs.on('error', reject);
    });
  }
  ws.end();
  await new Promise(r => ws.on('finish', r));
}

// ── Clean up partial chunk files ──
function cleanPartials(fp, n) {
  for (let i = 0; i < n; i++) {
    const p = `${fp}.part${i}`;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { }
  }
}

// ═══════════════════════════════════════════
//  YOUTUBE ENGINE
// ═══════════════════════════════════════════

let youtubeInstance = null;

async function getYoutubeInstance() {
  if (!youtubeInstance) {
    // Suppress youtubei.js debug output
    const origWarn = console.warn;
    console.warn = () => { };
    try {
      const { Innertube, Platform } = await import('youtubei.js');

      // Provide custom JavaScript evaluator for deciphering YouTube signature ciphers
      Platform.shim.eval = async (data) => {
        return new Function(data.output)();
      };

      youtubeInstance = await Innertube.create({ generate_session_locally: true });
    } finally {
      console.warn = origWarn;
    }
  }
  return youtubeInstance;
}

function isYouTubeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    return ['youtube.com', 'www.youtube.com', 'youtu.be', 'music.youtube.com', 'www.music.youtube.com'].some(domain => url.hostname.endsWith(domain));
  } catch {
    return false;
  }
}

function getYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/|live\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function sanitizeFilename(filename) {
  return filename.replace(/[\/\\?%*:|"<>\x00-\x1F]/g, '_');
}

function promptInteractiveMenu(options, headerText) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      resolve(options[0].value);
      return;
    }

    let selectedIndex = 0;
    let resolved = false;

    const stdin = process.stdin;

    stdin.listeners('keypress').forEach(listener => {
      stdin.removeListener('keypress', listener);
    });

    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    readline.emitKeypressEvents(stdin);

    process.stdout.write('\x1b[?25l');

    function drawMenu() {
      let out = '';
      out += `    \u26A1 ${headerText}\n`;
      for (let i = 0; i < options.length; i++) {
        const prefix = i === selectedIndex ? chalk.hex('#a855f7').bold('    \u27A4 ') : '      ';
        const text = i === selectedIndex
          ? chalk.hex('#a855f7').bold(`[ ${options[i].label} ]`)
          : dim(`  ${options[i].label}  `);
        out += `${prefix}${text}`;
        if (i < options.length - 1) out += '\n';
      }
      process.stdout.write(out);
    }

    drawMenu();

    function onKeypress(str, key) {
      if (resolved) return;
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
        return;
      }

      if (key.name === 'up' && selectedIndex > 0) {
        selectedIndex--;
        redrawMenu();
      } else if (key.name === 'down' && selectedIndex < options.length - 1) {
        selectedIndex++;
        redrawMenu();
      } else if (key.name === 'return') {
        resolved = true;
        cleanup();
        process.stdout.write(`\r\x1b[${options.length}A\x1b[J`);
        resolve(options[selectedIndex].value);
      }
    }

    function redrawMenu() {
      process.stdout.write(`\r\x1b[${options.length}A\x1b[J`);
      drawMenu();
    }

    function cleanup() {
      stdin.removeListener('keypress', onKeypress);
      if (stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\x1b[?25h');
    }

    stdin.on('keypress', onKeypress);
  });
}

// ── Check & retrieve FFmpeg path, installing automatically if missing ──
const getFfmpegPath = async () => {
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const localPath = path.join(BASE_DIR, binaryName);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 1. Check if system has global ffmpeg in PATH
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return 'ffmpeg';
  } catch (e) {
    // Not found in PATH
  }

  // 2. Try to download ffmpeg static binary automatically
  try {
    console.log('      ' + warning('⚡ ไม่พบ FFmpeg ในระบบ — กำลังดาวน์โหลด FFmpeg อัตโนมัติ...'));
    let downloadUrl = '';
    if (process.platform === 'win32') {
      downloadUrl = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0/win32-x64';
    } else if (process.platform === 'darwin') {
      downloadUrl = process.arch === 'arm64'
        ? 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0/darwin-arm64'
        : 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0/darwin-x64';
    } else {
      downloadUrl = process.arch === 'arm64'
        ? 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0/linux-arm64'
        : 'https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0/linux-x64';
    }

    await downloadFile(downloadUrl, localPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(localPath, '755'); // Make executable
    }
    return localPath;
  } catch (e) {
    // Failed to install or load
  }
  return null;
};

// Helper function to download a file (used for downloading yt-dlp)
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════
//  SELF-UPDATE SYSTEM
// ═══════════════════════════════════════════

// Fetch JSON from a URL (follows redirects)
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = new URL(url);
    options.headers = { 'User-Agent': 'ZELUX-DL/' + APP_VERSION };
    https.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchJSON(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Compare semver strings: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Check GitHub for a newer release. Returns { available, latest, downloadUrl, releaseNotes } or null
async function checkForUpdate() {
  if (!GITHUB_REPO) return null;
  try {
    const release = await fetchJSON(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const latestTag = release.tag_name; // e.g. "v1.1.0"
    if (compareVersions(latestTag, APP_VERSION) > 0) {
      // Find the right asset for this platform
      const exeName = process.platform === 'win32' ? 'ZELUX-DL.exe' : 'ZELUX-DL';
      const asset = release.assets.find(a => a.name.toLowerCase() === exeName.toLowerCase());
      return {
        available: true,
        latest: latestTag,
        current: APP_VERSION,
        downloadUrl: asset ? asset.browser_download_url : null,
        releaseNotes: (release.body || '').substring(0, 200)
      };
    }
    return { available: false, latest: latestTag, current: APP_VERSION };
  } catch (e) {
    return null; // Network error, silently ignore
  }
}

// Download and replace the running executable with the new version
async function selfUpdate() {
  console.log();
  console.log('    ' + info('🔍') + ' กำลังตรวจสอบเวอร์ชันล่าสุด...');

  const update = await checkForUpdate();

  if (!update) {
    if (!GITHUB_REPO) {
      console.log('    ' + warning('⚠️') + ' ยังไม่ได้ตั้งค่า GitHub repo');
      console.log('    ' + dim('    แก้ไข GITHUB_REPO ใน zelux.js เป็น ') + chalk.cyan("'username/ZELUX-DL'"));
    } else {
      console.log('    ' + error('✕') + ' ไม่สามารถเชื่อมต่อ GitHub ได้');
    }
    console.log();
    return false;
  }

  if (!update.available) {
    console.log('    ' + success('✓') + chalk.green.bold(` คุณใช้เวอร์ชันล่าสุดแล้ว! (v${update.current})`));
    console.log();
    return false;
  }

  console.log('    ' + chalk.hex('#fbbf24')('🎉') + chalk.yellow.bold(` พบเวอร์ชันใหม่! v${update.current} → ${update.latest}`));
  if (update.releaseNotes) {
    console.log('    ' + dim('    ' + update.releaseNotes.split('\n')[0]));
  }

  if (!update.downloadUrl) {
    console.log('    ' + error('✕') + ' ไม่พบไฟล์ดาวน์โหลดสำหรับระบบนี้');
    console.log();
    return false;
  }

  console.log('    ' + info('⬇️') + ' กำลังดาวน์โหลด ' + chalk.cyan(update.latest) + '...');

  const exePath = process.execPath;
  const tempPath = exePath + '.update';
  const backupPath = exePath + '.backup';

  try {
    // Download new version to temp file
    await downloadFile(update.downloadUrl, tempPath);

    if (process.platform === 'win32') {
      // On Windows, the running exe is locked. Use a .bat trampoline to:
      // 1. Wait for the current process to exit
      // 2. Replace the exe
      // 3. Restart
      const batPath = path.join(BASE_DIR, '_update.bat');
      const batContent = [
        '@echo off',
        'echo.',
        'echo  [ZELUX-DL] กำลังอัปเดต...',
        'ping 127.0.0.1 -n 2 > nul',  // Wait ~1 second
        `if exist "${backupPath}" del /f "${backupPath}"`,
        `move /y "${exePath}" "${backupPath}"`,
        `move /y "${tempPath}" "${exePath}"`,
        'echo  [ZELUX-DL] อัปเดตสำเร็จ! กำลังเปิดโปรแกรมใหม่...',
        'ping 127.0.0.1 -n 2 > nul',
        `start "" "${exePath}"`,
        `del /f "${backupPath}" 2>nul`,
        `del /f "%~f0"`,  // Delete this bat file
      ].join('\r\n');

      fs.writeFileSync(batPath, batContent, 'utf8');

      console.log();
      console.log('    ' + success('✓') + chalk.green.bold(' ดาวน์โหลดสำเร็จ! กำลังอัปเดต...'));
      console.log('    ' + dim('    โปรแกรมจะปิดและเปิดใหม่อัตโนมัติ'));
      console.log();

      // Launch the bat and exit
      const { spawn } = require('child_process');
      spawn('cmd.exe', ['/c', batPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();

      await sleep(500);
      process.exit(0);
    } else {
      // On Linux/macOS, we can replace the file directly
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(exePath, backupPath);
      fs.renameSync(tempPath, exePath);
      fs.chmodSync(exePath, '755');
      fs.unlinkSync(backupPath);

      console.log();
      console.log('    ' + success('✓') + chalk.green.bold(' อัปเดตสำเร็จ!'));
      console.log('    ' + dim('    กรุณาเปิดโปรแกรมใหม่เพื่อใช้เวอร์ชันล่าสุด'));
      console.log();
      return true;
    }
  } catch (e) {
    console.log('    ' + error('✕') + ' อัปเดตล้มเหลว: ' + e.message);
    // Cleanup temp file
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) { }
    console.log();
    return false;
  }
}

// ── Check &amp; retrieve yt-dlp path, downloading automatically if missing ──
const getYtDlpPath = async () => {
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localPath = path.join(BASE_DIR, binaryName);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  try {
    console.log('      ' + warning(`⚡ ไม่พบ yt-dlp — กำลังดาวน์โหลด yt-dlp ล่าสุดอัตโนมัติ...`));
    const downloadUrl = process.platform === 'win32'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    await downloadFile(downloadUrl, localPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(localPath, '755'); // Make executable
    }
    await sleep(1000); // Wait 1 second to release lock
    return localPath;
  } catch (err) {
    try {
      const { execSync } = require('child_process');
      execSync('yt-dlp --version', { stdio: 'ignore' });
      return 'yt-dlp';
    } catch (e) {
      return null;
    }
  }
};

async function downloadYouTubeFile(url) {
  console.log('      ' + info('\u27F3') + ' กำลังเตรียมระบบ YouTube...');

  const ytdlpPath = await getYtDlpPath();
  if (!ytdlpPath) {
    console.log('      ' + error('\u2715') + ' ไม่พบ yt-dlp ในระบบและไม่สามารถดาวน์โหลดได้');
    console.log();
    return;
  }

  const ffmpegPath = await getFfmpegPath();

  const isM3u8 = url.toLowerCase().includes('.m3u8') || url.includes('zelux_m3u8=true');

  if (!isYouTubeUrl(url) && !isM3u8) {
    console.log('      ' + error('\u2715') + ' ลิงก์ไม่รองรับ');
    console.log();
    return;
  }

  console.log('      ' + info('\u27F3') + ' กำลังตรวจสอบข้อมูลสื่อ...');

  let isPlaylist = false;
  let playlistTitle = '';
  let entriesCount = 1;
  let metadata = null;

  try {
    const getFlatMetadata = (ytdlp, targetUrl) => {
      return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        exec(`"${ytdlp}" --dump-json --flat-playlist --js-runtimes node${getCookiesArgs().str} "${targetUrl}"`, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve(stdout.trim());
        });
      });
    };

    const flatStdout = await getFlatMetadata(ytdlpPath, url);
    const lines = flatStdout.split('\n').filter(Boolean);
    if (lines.length > 0) {
      const firstEntry = JSON.parse(lines[0]);
      playlistTitle = firstEntry.playlist_title || firstEntry.playlist;
      if (playlistTitle || lines.length > 1) {
        isPlaylist = true;
        entriesCount = firstEntry.n_entries || lines.length;
      } else {
        metadata = firstEntry;
      }
    }
  } catch (err) {
    console.log('      ' + error('\u2715') + ' ไม่สามารถตรวจสอบข้อมูลลิงก์ได้: ' + err.message);
    console.log();
    return;
  }

  // If it's a single video, fetch its full metadata for precise size/quality info
  if (!isPlaylist) {
    try {
      const getFullMetadata = (ytdlp, targetUrl) => {
        return new Promise((resolve, reject) => {
          const { exec } = require('child_process');
          exec(`"${ytdlp}" --dump-json --js-runtimes node --no-playlist${getCookiesArgs().str} "${targetUrl}"`, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(err);
            try {
              resolve(JSON.parse(stdout));
            } catch (pe) {
              reject(pe);
            }
          });
        });
      };
      metadata = await getFullMetadata(ytdlpPath, url);
    } catch (err) {
      // Non-fatal fallback
    }
  }

  // Ask format selection via interactive menu
  const formatType = await promptInteractiveMenu([
    { label: '🎵 MP3 (เสียงเท่านั้น)', value: 'mp3' },
    { label: '🎬 MP4 (วิดีโอพร้อมเสียง)', value: 'mp4' }
  ], 'เลือกรูปแบบดาวน์โหลด:');

  let selectedQuality = 'best';
  if (formatType === 'mp4') {
    let qualOptions = [];
    if (metadata && metadata.formats) {
      const heights = new Set();
      metadata.formats.forEach(f => {
        if (f.vcodec !== 'none' && f.height) heights.add(f.height);
      });
      const sortedHeights = Array.from(heights).sort((a, b) => b - a);
      const commonHeights = [2160, 1440, 1080, 720, 480, 360, 144];
      const availableCommon = sortedHeights.filter(h => commonHeights.includes(h));
      const heightsToShow = availableCommon.length > 0 ? availableCommon : sortedHeights;

      qualOptions.push({ label: '🌟 คุณภาพสูงสุด (Best Available)', value: 'best' });
      for (const h of heightsToShow.slice(0, 4)) {
        qualOptions.push({ label: `🎬 ${h}p`, value: h.toString() });
      }
    } else {
      qualOptions = [
        { label: '🌟 คุณภาพสูงสุด (Best Available)', value: 'best' },
        { label: '🎬 1080p', value: '1080' },
        { label: '🎬 720p', value: '720' },
        { label: '🎬 480p', value: '480' }
      ];
    }
    selectedQuality = await promptInteractiveMenu(qualOptions, 'เลือกความละเอียดวิดีโอ (Resolutions):');
  }

  let extension;
  let subfolderName;
  let totalSize = isPlaylist ? 0 : (metadata?.filesize || metadata?.filesize_approx || 0);
  let isMuxed = false;

  if (formatType === 'mp3') {
    subfolderName = 'Music';
    extension = ffmpegPath ? '.mp3' : '.m4a';
  } else {
    subfolderName = 'Video';
    extension = '.mp4';
    if (ffmpegPath) {
      isMuxed = true;
    }
  }

  let title = '';
  let filename = '';
  let targetDir = '';
  let filePath = '';

  if (isPlaylist) {
    title = playlistTitle || 'youtube_playlist';
    targetDir = path.join(DOWNLOADS_DIR, subfolderName, sanitizeFilename(title));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    // Output template for playlist
    filePath = path.join(targetDir, `%(title)s${extension}`);
  } else {
    title = metadata?.title || `youtube_video`;
    filename = sanitizeFilename(title) + extension;
    targetDir = path.join(DOWNLOADS_DIR, subfolderName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    filePath = getUniqueFilePath(targetDir, filename);
  }

  console.log('      ' + success('\u2713') + ' เชื่อมต่อสำเร็จ!');
  if (formatType === 'mp4' && !isMuxed) {
    console.log('      ' + warning('⚠️  ไม่พบ FFmpeg ในระบบ (สลับใช้สตรีมรวมสูงสุด 720p แทน)'));
  }
  if (formatType === 'mp3' && !ffmpegPath) {
    console.log('      ' + warning('⚠️  ไม่พบ FFmpeg ในระบบ (บันทึกเป็นไฟล์เสียงดิบ .m4a แทน .mp3)'));
  }
  console.log();

  if (isPlaylist) {
    const displayTitle = title.length > 25 ? title.substring(0, 22) + '...' : title;
    console.log('      ' + white('📄 เพลย์ลิสต์: ') + chalk.cyan(displayTitle));
    console.log('      ' + white('📦 จำนวน: ') + chalk.yellow(`${entriesCount} วิดีโอ`));
  } else {
    const displayFilename = filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
    console.log('      ' + white('📄 ไฟล์: ') + chalk.cyan(displayFilename));
    console.log('      ' + white('📦 ขนาด: ') + (totalSize > 0 ? chalk.yellow(formatBytes(totalSize)) : dim('ไม่ทราบ')));
  }

  let mimeStr = formatType === 'mp3' ? (ffmpegPath ? 'audio/mp3' : 'audio/mp4') : 'video/mp4';
  console.log('      ' + white('📝 ชนิด: ') + dim(mimeStr));

  const qualStr = formatType === 'mp3' ? 'audio/best' : (isMuxed ? (selectedQuality === 'best' ? (metadata?.height ? `${metadata.height}p` : 'Best Available') : `${selectedQuality}p`) : 'best (~720p)');
  console.log('      ' + white('✨ คุณภาพ: ') + chalk.hex('#10b981').bold(qualStr));

  if (isPlaylist) {
    console.log('      ' + white('📁 โฟลเดอร์: ') + chalk.yellow.bold(path.join(subfolderName, sanitizeFilename(title))));
  } else {
    console.log('      ' + white('📁 โฟลเดอร์: ') + chalk.yellow.bold(subfolderName));
  }
  console.log();

  let isFirstFrame = true;
  const barSize = 33;
  const bar = new cliProgress.SingleBar({
    format: (options, params, payload) => {
      const filled = Math.round(params.progress * barSize);
      const empty = barSize - filled;
      const rb = rainbowBar(filled, empty);
      const pct = (params.progress * 100).toFixed(1) + '%';
      const spd = chalk.hex('#f472b6').bold((payload.speed || '0 B/s').padEnd(12));
      const sizeStr = chalk.hex('#94a3b8')(`${payload.downloaded || '0 B'}/${payload.total || '??'}`);
      const etaStr = chalk.hex('#34d399').bold(`\u23F3 ${payload.eta_formatted || '--:--'}`);

      const line1 = `      ${rb} ${chalk.bold.white(pct.padStart(6))}`;
      const line2 = `      ${spd} \u2502 ${sizeStr} \u2502 ${etaStr}`;

      if (isFirstFrame) {
        isFirstFrame = false;
        return `${line1}\n${line2}`;
      } else {
        return `\x1b[1A\r${line1}\x1b[K\n${line2}\x1b[K`;
      }
    },
    barsize: barSize,
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: false,
    forceRedraw: true,
  });

  // Show cancel hint
  console.log('      ' + dim('(กด Esc เพื่อยกเลิก)'));

  bar.start(1, 0, {
    speed: '0 B/s',
    downloaded: isPlaylist ? `(1/${entriesCount}) 0%` : '0%',
    total: totalSize > 0 ? formatBytes(totalSize) : '??',
    eta_formatted: '--:--',
  });

  const startTime = Date.now();
  let finalDownloadedBytes = 0;

  const args = [];

  if (formatType === 'mp3') {
    if (ffmpegPath) {
      args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3');
      if (ffmpegPath !== 'ffmpeg') {
        args.push('--ffmpeg-location', ffmpegPath);
      }
    } else {
      args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
    }
  } else {
    if (isMuxed) {
      if (selectedQuality === 'best') {
        args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      } else {
        args.push('-f', `bestvideo[height<=${selectedQuality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${selectedQuality}][ext=mp4]/best`);
      }
      if (ffmpegPath !== 'ffmpeg') {
        args.push('--ffmpeg-location', ffmpegPath);
      }
    } else {
      args.push('-f', 'best[ext=mp4]/best');
    }
  }

  if (!isPlaylist) {
    args.push('--no-playlist');
  } else {
    args.push('-i'); // Ignore errors for individual videos in playlist
  }

  if (ffmpegPath) {
    args.push('--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg');
  }

  // ทะลวงลิมิตความเร็วของ YouTube โดยใช้เทคนิคการโหลดพร้อมกันหลายท่อ (Multi-connection for DASH/HLS)
  args.push('--concurrent-fragments', '32');

  const cookieArgs = getCookiesArgs().arr;
  if (cookieArgs.length > 0) args.push(...cookieArgs);
  args.push('--js-runtimes', 'node', '-o', filePath, url);

  const { spawn } = require('child_process');

  // Start cancel listener
  cancelCtrl.startListening();

  try {
    const warningMsg = await new Promise((resolve, reject) => {
      const child = spawn(ytdlpPath, args);
      cancelCtrl.childProcess = child;
      let stderrData = '';
      let currentItem = 1;
      let totalItems = entriesCount;

      child.stdout.on('data', (data) => {
        const line = data.toString();

        // Track current item in playlist
        const itemMatch = line.match(/\[download\]\s+Downloading\s+item\s+(\d+)\s+of\s+(\d+)/i);
        if (itemMatch) {
          currentItem = parseInt(itemMatch[1], 10);
          totalItems = parseInt(itemMatch[2], 10);
        }

        const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s|Unknown\s+B\/s)\s+ETA\s+([\d:]+|Unknown)/i);
        if (match) {
          const pct = parseFloat(match[1]);
          const size = match[2];
          const speed = match[3];
          const eta = match[4];

          const val = isPlaylist ? (currentItem - 1 + pct / 100) / totalItems : pct / 100;
          bar.update(val, {
            speed: speed,
            downloaded: isPlaylist ? `(${currentItem}/${totalItems}) ${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`,
            total: size,
            eta_formatted: eta
          });
        } else if (line.includes('[Merger]')) {
          bar.update(isPlaylist ? currentItem / totalItems : 1.0, {
            speed: 'Muxing...',
            downloaded: isPlaylist ? `(${currentItem}/${totalItems}) 100%` : '100%',
            total: totalSize > 0 ? formatBytes(totalSize) : '??',
            eta_formatted: '00:00'
          });
        } else if (line.includes('[ExtractAudio]')) {
          bar.update(isPlaylist ? currentItem / totalItems : 1.0, {
            speed: 'Extracting...',
            downloaded: isPlaylist ? `(${currentItem}/${totalItems}) 100%` : '100%',
            total: totalSize > 0 ? formatBytes(totalSize) : '??',
            eta_formatted: '00:00'
          });
        }
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      child.on('close', async (code) => {
        cancelCtrl.childProcess = null;
        if (cancelCtrl.cancelled) {
          return reject(new Error('CANCELLED'));
        }
        if (code === 0) resolve();
        else {
          // Format stderr message so it doesn't leak full trace or look ugly in terminal
          let cleanStderr = stderrData.split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('ERROR:') || line.startsWith('WARNING:'))
            .join(' | ') || stderrData.trim();

          // Workaround for Windows WinError 32 on rename (e.g. Antivirus lock)
          if (cleanStderr.includes('[WinError 32]')) {
            await new Promise(r => setTimeout(r, 3000));
            let tempFile = '';
            let finalFile = '';
            const match = stderrData.match(/'([^']+)'\s*->\s*'([^']+)'/);
            if (match) {
              tempFile = match[1].replace(/\\\\/g, '\\');
              finalFile = match[2].replace(/\\\\/g, '\\');
            }
            // If regex file doesn't exist (due to emoji/encoding mangle), use our known filePath
            if (!tempFile || !fs.existsSync(tempFile)) {
              if (!isPlaylist && filePath && extension) {
                tempFile = filePath.substring(0, filePath.length - extension.length) + '.temp' + extension;
                finalFile = filePath;
              }
            }

            if (tempFile && finalFile && fs.existsSync(tempFile)) {
              try {
                if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
                fs.renameSync(tempFile, finalFile);
                return resolve(); // Recovered successfully
              } catch (e) {
                cleanStderr += ` (Recovery failed: ${e.message})`;
              }
            } else {
              cleanStderr += ` (Recovery failed: temp file not found. Path: ${tempFile})`;
            }
          }

          if (isPlaylist) {
            return resolve(cleanStderr);
          }

          reject(new Error(cleanStderr || `yt-dlp exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });

    cancelCtrl.stopListening();

    bar.update(1.0, {
      speed: '✓ Done!',
      downloaded: isPlaylist ? `(${entriesCount}/${entriesCount}) 100%` : '100%',
      total: totalSize > 0 ? formatBytes(totalSize) : '??',
      eta_formatted: '00:00'
    });
    bar.stop();

    if (!isPlaylist) {
      try {
        const stats = fs.statSync(filePath);
        finalDownloadedBytes = stats.size;
      } catch (e) {
        finalDownloadedBytes = totalSize;
      }
    } else {
      try {
        const getDirSize = (dir) => {
          let size = 0;
          const files = fs.readdirSync(dir);
          for (const f of files) {
            const fp = path.join(dir, f);
            const stats = fs.statSync(fp);
            if (stats.isFile()) size += stats.size;
          }
          return size;
        };
        finalDownloadedBytes = getDirSize(targetDir);
      } catch (e) {
        finalDownloadedBytes = 0;
      }
    }

    // SHA256 (skip for playlist directory)
    let hash = '';
    if (!isPlaylist) {
      process.stdout.write('      ' + dim('🔒 กำลังคำนวณ SHA256...'));
      hash = await calculateSHA256(filePath);
      process.stdout.write('\r\x1b[K');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgSpd = finalDownloadedBytes / ((Date.now() - startTime) / 1000);

    console.log();
    console.log('    ' + rainbowLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', Date.now() / 5));
    if (isPlaylist && warningMsg) {
      console.log('      ' + warning.bold('⚠️ ดาวน์โหลดเสร็จสิ้น (มีบางไฟล์ขัดข้อง)'));
      console.log('      ' + dim(warningMsg.length > 150 ? warningMsg.substring(0, 147) + '...' : warningMsg));
    } else {
      console.log('      ' + success.bold('✓ ดาวน์โหลดเสร็จสิ้น!'));
    }
    console.log('      ' + dim('ขนาด      : ') + chalk.yellow(formatBytes(finalDownloadedBytes)));
    console.log('      ' + dim('เวลา      : ') + chalk.yellow(elapsed + ' วินาที'));
    console.log('      ' + dim('เฉลี่ย     : ') + chalk.hex('#818cf8')(formatSpeed(avgSpd)));

    if (isPlaylist) {
      const relativeSavedPath = path.join('downloads', subfolderName, sanitizeFilename(title));
      const displayFilePath = relativeSavedPath.length > 30 ? '...' + relativeSavedPath.substring(relativeSavedPath.length - 27) : relativeSavedPath;
      console.log('      ' + dim('โฟลเดอร์   : ') + chalk.cyan(displayFilePath));
      console.log('      ' + dim('จำนวน     : ') + chalk.yellow(`${entriesCount} ไฟล์`));
    } else {
      const relativeSavedPath = path.join('downloads', subfolderName, filename);
      const displayFilePath = relativeSavedPath.length > 30 ? '...' + relativeSavedPath.substring(relativeSavedPath.length - 27) : relativeSavedPath;
      console.log('      ' + dim('บันทึก    : ') + chalk.cyan(displayFilePath));
      const displayHash = hash.substring(0, 12) + '...' + hash.substring(hash.length - 12);
      console.log('      ' + dim('SHA256    : ') + accent(displayHash));
    }
    console.log('    ' + rainbowLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', Date.now() / 5));
    console.log();

    // Clean up thumbnail files left behind by yt-dlp after successful embed
    try {
      const dir = isPlaylist ? targetDir : path.dirname(filePath);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith('.webp') || f.endsWith('.jpg') || f.endsWith('.png')) {
            if (isPlaylist) {
              try { fs.unlinkSync(path.join(dir, f)); } catch (e) { }
            } else {
              const baseName = filename.substring(0, filename.lastIndexOf('.'));
              if (f.startsWith(baseName)) {
                try { fs.unlinkSync(path.join(dir, f)); } catch (e) { }
              }
            }
          }
        }
      }
    } catch (e) { }

  } catch (err) {
    cancelCtrl.stopListening();
    bar.stop();

    if (err.message === 'CANCELLED') {
      process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      console.log('      ' + warning.bold('⚠️ ยกเลิกการดาวน์โหลดแล้ว'));
      // Clean up incomplete files
      if (!isPlaylist) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { }
      }
      // Clean up temp/part files
      try {
        const dir = isPlaylist ? targetDir : path.dirname(filePath);
        if (fs.existsSync(dir)) {
          const tempFiles = fs.readdirSync(dir).filter(f => f.endsWith('.part') || f.endsWith('.temp') || f.endsWith('.ytdl'));
          for (const tf of tempFiles) {
            try { fs.unlinkSync(path.join(dir, tf)); } catch (e) { }
          }
        }
      } catch (e) { }
      console.log();
    } else {
      process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      console.log('      ' + error('✕') + ' ดาวน์โหลดล้มเหลว: ' + err.message);
      if (!isPlaylist) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { }
      }
      console.log();
    }
  }
}

// ── Download a single file ──
async function downloadSingleFile(url) {
  const isM3u8 = url.toLowerCase().includes('.m3u8') || url.includes('zelux_m3u8=true');
  if (isYouTubeUrl(url) || isM3u8) {
    await downloadYouTubeFile(url);
    return;
  }
  console.log('      ' + info('\u27F3') + ' กำลังตรวจสอบลิงก์...');

  let fileInfo;
  try {
    fileInfo = await probeFileInfo(url);
  } catch (err) {
    console.log('      ' + error('\u2715') + ' ไม่สามารถเชื่อมต่อได้: ' + err.message);
    console.log();
    return;
  }

  const { finalUrl, acceptRanges, totalSize, filename, contentType } = fileInfo;

  let category = 'Others';
  const ext = path.extname(filename).toLowerCase();
  const cType = contentType.toLowerCase();
  if (cType.startsWith('video/') || ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts'].includes(ext)) {
    category = 'Video';
  } else if (cType.startsWith('audio/') || ['.mp3', '.m4a', '.wav', '.flac', '.ogg'].includes(ext)) {
    category = 'Audio';
  } else if (cType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    category = 'Images';
  } else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    category = 'Archives';
  } else if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'].includes(ext)) {
    category = 'Documents';
  }

  const targetDir = path.join(DOWNLOADS_DIR, category);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filePath = getUniqueFilePath(targetDir, filename);
  let useMulti = acceptRanges && totalSize > 1024 * 1024;
  let connCount = useMulti ? NUM_CONNECTIONS : 1;

  console.log('      ' + success('\u2713') + ' เชื่อมต่อสำเร็จ!');
  console.log();
  const displayFilename = filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
  console.log('      ' + white('\uD83D\uDCC4 ไฟล์: ') + chalk.cyan(displayFilename));
  console.log('      ' + white('\uD83D\uDCE6 ขนาด: ') + (totalSize > 0 ? chalk.yellow(formatBytes(totalSize)) : dim('ไม่ทราบ')));
  console.log('      ' + white('\uD83D\uDCDD ชนิด: ') + dim(contentType));
  console.log('      ' + white('📁 หมวดหมู่: ') + chalk.yellow.bold(category));
  console.log('      ' + white('\uD83D\uDD17 Mode: ') + (useMulti ? chalk.green.bold(`${connCount}x Multi-connection`) : dim('Single connection')));
  console.log();

  let isFirstFrame = true;

  const barSize = 33;
  const bar = new cliProgress.SingleBar({
    format: (options, params, payload) => {
      const filled = Math.round(params.progress * barSize);
      const empty = barSize - filled;
      const rb = rainbowBar(filled, empty);
      const pct = (params.progress * 100).toFixed(1) + '%';
      const spd = chalk.hex('#f472b6').bold((payload.speed || '0 B/s').padEnd(12));
      const sizeStr = chalk.hex('#94a3b8')(`${payload.downloaded || '0 B'}/${payload.total || '??'}`);
      const etaStr = chalk.hex('#34d399').bold(`\u23F3 ${payload.eta_formatted || '--:--'}`);

      const line1 = `      ${rb} ${chalk.bold.white(pct.padStart(6))}`;
      const line2 = `      ${spd} \u2502 ${sizeStr} \u2502 ${etaStr}`;

      if (isFirstFrame) {
        isFirstFrame = false;
        return `${line1}\n${line2}`;
      } else {
        return `\x1b[1A\r${line1}\x1b[K\n${line2}\x1b[K`;
      }
    },
    barsize: barSize,
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: false,
    forceRedraw: true,
  });

  // Show cancel hint
  console.log('      ' + dim('(กด Esc เพื่อยกเลิก)'));

  bar.start(totalSize > 0 ? totalSize : 1, 0, {
    speed: '0 B/s',
    downloaded: '0 B',
    total: totalSize > 0 ? formatBytes(totalSize) : '??',
    eta_formatted: '--:--',
  });

  let downloadedBytes = 0;
  let lastTime = Date.now();
  let lastBytes = 0;
  let currentSpeed = 0;
  const startTime = Date.now();

  const redrawTimer = setInterval(() => {
    // Check if cancelled during download
    if (cancelCtrl.cancelled) {
      clearInterval(redrawTimer);
      return;
    }
    const eta = currentSpeed > 0 && totalSize > 0 ? (totalSize - downloadedBytes) / currentSpeed : 0;
    bar.update(Math.min(downloadedBytes, totalSize > 0 ? totalSize : 1), {
      speed: formatSpeed(currentSpeed),
      downloaded: formatBytes(downloadedBytes),
      eta_formatted: formatETA(eta),
    });
  }, 60);

  const onData = (bytes) => {
    downloadedBytes += bytes;
    const now = Date.now();
    const el = (now - lastTime) / 1000;
    if (el >= 0.3) {
      currentSpeed = (downloadedBytes - lastBytes) / el;
      lastTime = now;
      lastBytes = downloadedBytes;
    }
  };

  // Start cancel listener
  cancelCtrl.startListening();

  try {
    if (useMulti) {
      try {
        const chunkSize = Math.ceil(totalSize / connCount);
        const promises = [];
        for (let i = 0; i < connCount; i++) {
          const s = i * chunkSize;
          const e = i === connCount - 1 ? totalSize - 1 : s + chunkSize - 1;
          const p = downloadRange(finalUrl, s, e, `${filePath}.part${i}`, onData, 0, false);
          p.catch(() => { });
          promises.push(p);
        }
        await Promise.all(promises);

        bar.update(totalSize, { speed: '\uD83D\uDD17 Merging...', eta_formatted: '...' });
        await mergeChunks(filePath, connCount);
      } catch (multiErr) {
        if (cancelCtrl.cancelled) throw new Error('CANCELLED');
        abortAllDownloads();
        downloadedBytes = 0;
        lastBytes = 0;
        currentSpeed = 0;
        isFirstFrame = true;

        process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
        console.log('      ' + warning('\u26A0') + dim(` Multi-connection ล้มเหลว (${multiErr.message}) — สลับเป็น Single ใน 2 วินาที...`));
        await sleep(2000);

        cleanPartials(filePath, connCount);

        await downloadRange(finalUrl, undefined, undefined, filePath, onData, 0, true);
      }
    } else {
      await downloadRange(finalUrl, undefined, undefined, filePath, onData, 0, true);
    }

    if (cancelCtrl.cancelled) throw new Error('CANCELLED');

    cancelCtrl.stopListening();
    clearInterval(redrawTimer);
    bar.update(totalSize > 0 ? totalSize : 1, { speed: '\u2713 Done!', eta_formatted: '0:00', downloaded: formatBytes(downloadedBytes) });
    bar.stop();
    abortAllDownloads();

    process.stdout.write('      ' + dim('\uD83D\uDD12 กำลังคำนวณ SHA256...'));
    const hash = await calculateSHA256(filePath);
    process.stdout.write('\r\x1b[K');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgSpd = downloadedBytes / ((Date.now() - startTime) / 1000);

    console.log();
    console.log('    ' + rainbowLine('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501', Date.now() / 5));
    console.log('      ' + success.bold('\u2713 ดาวน์โหลดเสร็จสิ้น!'));
    console.log('      ' + dim('ขนาด      : ') + chalk.yellow(formatBytes(downloadedBytes)));
    console.log('      ' + dim('เวลา      : ') + chalk.yellow(elapsed + ' วินาที'));
    console.log('      ' + dim('เฉลี่ย     : ') + chalk.hex('#818cf8')(formatSpeed(avgSpd)));
    const displayFilePath = filePath.length > 30 ? '...' + filePath.substring(filePath.length - 27) : filePath;
    console.log('      ' + dim('บันทึก    : ') + chalk.cyan(displayFilePath));
    const displayHash = hash.substring(0, 12) + '...' + hash.substring(hash.length - 12);
    console.log('      ' + dim('SHA256    : ') + accent(displayHash));
    console.log('    ' + rainbowLine('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501', Date.now() / 5));
    console.log();

  } catch (err) {
    cancelCtrl.stopListening();
    clearInterval(redrawTimer);
    bar.stop();
    abortAllDownloads();

    if (err.message === 'CANCELLED') {
      process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      console.log('      ' + warning.bold('⚠️ ยกเลิกการดาวน์โหลดแล้ว'));
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { }
      cleanPartials(filePath, connCount);
      console.log();
    } else {
      process.stdout.write('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      console.log('      ' + error('\u2715') + ' ดาวน์โหลดล้มเหลว: ' + err.message);
      cleanPartials(filePath, connCount);
      console.log();
    }
  }
}

// ═══════════════════════════════════════════
//  BATCH
// ═══════════════════════════════════════════

async function handleBatch(urls) {
  if (urls.length === 1) { await downloadSingleFile(urls[0]); return; }
  console.log();
  console.log('  ' + info('\uD83D\uDCE6') + ` Batch Download — ${chalk.yellow(urls.length)} ไฟล์`);
  for (let i = 0; i < urls.length; i++) {
    console.log();
    console.log('  ' + rainbowLine(`── [ ${i + 1} / ${urls.length} ] ──`, Date.now() / 5));
    console.log('  ' + dim(urls[i].length > 70 ? urls[i].substring(0, 67) + '...' : urls[i]));
    await downloadSingleFile(urls[i]);
  }
  console.log('  ' + rainbowLine(' \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550', Date.now() / 5));
  console.log('  ' + success.bold(`\u2713 Batch เสร็จสิ้น! ${urls.length} ไฟล์`));
  console.log('  ' + rainbowLine(' \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550', Date.now() / 5));
  console.log();
}

// ═══════════════════════════════════════════
//  FILE MANAGEMENT
// ═══════════════════════════════════════════

function openFolder() {
  const { exec } = require('child_process');
  const p = os.platform();
  if (p === 'win32') exec(`explorer "${DOWNLOADS_DIR.replace(/\//g, '\\')}"`);
  else if (p === 'darwin') exec(`open "${DOWNLOADS_DIR}"`);
  else exec(`xdg-open "${DOWNLOADS_DIR}"`);
}

function isValidUrl(s) {
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol); }
  catch { return false; }
}

function resizeTerminal(cols = 80, rows = 25) {
  process.stdout.write(`\x1b[8;${rows};${cols}t`);
  if (process.stdout.isTTY) {
    try { process.stdout.setWindowSize(cols, rows); } catch (e) { }
  }
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync(`mode con: cols=${cols} lines=${rows}`);
    } catch (e) { }
  }
}



// ═══════════════════════════════════════════
//  MAIN & READLINE LOOP
// ═══════════════════════════════════════════
let rl = null;

const subPrompt = () => '    [Enter กลับหน้าหลัก] \u276F ';

// Write the colored ZELUX-DL prompt manually (not through readline)
function writePrompt() {
  if (currentView !== 'default') {
    process.stdout.write('    ' + chalk.hex('#818cf8')('[Enter กลับหน้าหลัก]') + chalk.hex('#a855f7')(' \u276F '));
  } else {
    process.stdout.write(brand('    ZELUX') + chalk.hex('#fbbf24')('-DL') + chalk.hex('#a855f7')(' \u276F '));
  }
}

function createReadline() {
  // Remove ALL listeners and close old readline completely
  if (rl) {
    try { rl.removeAllListeners(); rl.close(); } catch (e) { }
    rl = null;
  }

  // Remove any stale data/keypress listeners on stdin to prevent duplicates
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('keypress');

  // Ensure stdin is NOT in raw mode — let the terminal driver handle echo & editing
  if (process.stdin.setRawMode) {
    try { process.stdin.setRawMode(false); } catch (e) { }
  }
  process.stdin.resume();

  // Use terminal: false so readline does NOT manage echo/cursor.
  // The Windows terminal driver handles character echo, backspace, line editing natively.
  // This completely prevents the duplicate-text bug caused by readline re-hooking stdin.
  const newRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl = newRl;

  newRl.on('line', handleLineInput);
  newRl.on('close', () => {
    console.log();
    console.log('    ' + rainbowLine('👋 ขอบคุณที่ใช้ ZELUX-DL!', Date.now() / 5));
    console.log();
    process.exit(0);
  });

  // Write the colored prompt manually
  writePrompt();
}

async function handleLineInput(line) {
  if (!rl) return;

  if (currentView !== 'default') {
    // Any input (including just Enter) in non-default views returns to main menu
    currentView = 'default';
    renderScreen();
    createReadline();
    return;
  }

  const input = line.trim();

  if (!input) {
    // Empty enter — erase the blank line and rewrite prompt in place (no visible change)
    process.stdout.write('\x1b[1A\x1b[2K');
    writePrompt();
    return;
  }

  const cmd = input.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case 'help': case 'h': case '?':
      currentView = 'help';
      renderScreen();
      createReadline();
      break;

    case 'list': case 'ls': case 'l':
      currentView = 'list';
      renderScreen();
      createReadline();
      break;

    case 'clear': case 'cls':
      currentView = 'default';
      renderScreen();
      createReadline();
      break;

    case 'open': case 'o':
      openFolder();
      currentView = 'open';
      renderScreen();
      createReadline();
      break;

    case 'update': case 'u':
      if (rl) { rl.removeAllListeners('close'); rl.close(); rl = null; }
      currentView = 'update';
      renderScreen();
      await runUpdate();
      currentView = 'download-done';
      createReadline();
      break;

    case 'upgrade':
      if (rl) { rl.removeAllListeners('close'); rl.close(); rl = null; }
      currentView = 'upgrade';
      renderScreen();
      await selfUpdate();
      currentView = 'download-done';
      createReadline();
      break;

    case 'exit': case 'quit': case 'q':
      console.log(); console.log('    ' + rainbowLine('\uD83D\uDC4B ขอบคุณที่ใช้ ZELUX-DL!', Date.now() / 5)); console.log();
      process.exit(0);

    default:
      let targetUrl = input;

      // Support custom URI scheme (zelux://https://...)
      if (targetUrl && targetUrl.startsWith('zelux://')) {
        targetUrl = targetUrl.replace(/^zelux:\/\//, '');

        // In some browsers, it might encode the rest of the URL or add a trailing slash
        if (targetUrl.endsWith('/')) {
          targetUrl = targetUrl.slice(0, -1);
        }
        // Windows strips the colon from "https://" → "https//"
        targetUrl = targetUrl.replace(/^(https?)\/\//, '$1://');
        try { targetUrl = decodeURIComponent(targetUrl); } catch (e) { }
      }

      let urls = [];

      // Check if the input itself is a valid URL
      if (isValidUrl(targetUrl)) {
        urls = [targetUrl];
      } else if (targetUrl.endsWith('.txt')) {
        // Check if it's a .txt batch file
        const txtPath = path.isAbsolute(targetUrl) ? targetUrl : path.join(BASE_DIR, targetUrl);
        if (fs.existsSync(txtPath)) {
          const content = fs.readFileSync(txtPath, 'utf8');
          urls = content.split(/\r?\n/).map(l => l.trim()).filter(isValidUrl);
          if (urls.length > 0) {
            console.log('    ' + info('📦') + ' ดึงลิงก์จากไฟล์สำเร็จ ' + chalk.yellow(urls.length) + ' ลิงก์');
          }
        }
      }

      if (urls.length > 0) {
        // Close readline temporarily so YouTube menu can use raw stdin
        if (rl) {
          rl.removeAllListeners('close');
          rl.close();
          rl = null;
        }

        currentView = 'download';
        renderScreen();
        await handleBatch(urls);
        currentView = 'download-done';

        // Recreate readline after download completes
        createReadline();
      } else {
        console.log();
        console.log('    ' + error('\u2715') + ' ไม่รู้จักคำสั่ง / URL ไม่ถูกต้อง');
        console.log('    ' + dim('    พิมพ์ ') + chalk.hex('#fbbf24').bold('help') + dim(' ดูคำสั่งทั้งหมด'));
        console.log();
        writePrompt();
      }
  }
}

async function runUpdate() {
  console.log('      ' + info('⚡') + ' กำลังตรวจสอบและอัปเดต yt-dlp และ ffmpeg...');

  const ytdlpPath = path.join(BASE_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ffmpegPath = path.join(BASE_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

  try {
    if (fs.existsSync(ytdlpPath)) fs.unlinkSync(ytdlpPath);
    if (fs.existsSync(ffmpegPath)) fs.unlinkSync(ffmpegPath);
  } catch (e) {
    console.log('      ' + warning('⚠️') + ' ไม่สามารถลบไฟล์เก่าได้ (อาจจะกำลังถูกใช้งานอยู่)');
  }

  await getYtDlpPath();
  await getFfmpegPath();

  console.log();
  console.log('      ' + success.bold('✓ อัปเดตเสร็จสิ้น!'));
}

async function main() {
  resizeTerminal(47, 22);
  await animatedIntro();
  currentView = 'default';
  renderScreen();

  let args = process.argv.slice(2);
  try {
    fs.writeFileSync(require('path').join(BASE_DIR, 'args.log'), JSON.stringify({ argv: process.argv, cwd: process.cwd(), args: args }));
  } catch (e) { }

  // Handle zelux:// protocol
  args = args.map(arg => {
    let match = arg.match(/^zelux:\/\/(.+)$/i);
    if (match) {
      let cleaned = match[1];
      if (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
      try { cleaned = decodeURIComponent(cleaned); } catch (e) { }
      // Windows strips the colon from "https://" → "https//"
      cleaned = cleaned.replace(/^(https?)\/\//, '$1://');
      return cleaned;
    }
    return arg;
  });

  args = args.filter(isValidUrl);
  if (args.length > 0) {
    currentView = 'download';
    renderScreen();
    await handleBatch(args);
    currentView = 'download-done';
  }

  createReadline();
}

main();
