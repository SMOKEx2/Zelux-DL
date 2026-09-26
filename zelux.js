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
const yauzl = require('yauzl');
const os = require('os');
const crypto = require('crypto');
const { once } = require('events');
const { execSync, execFileSync, spawn } = require('child_process');
const { TerminalUI, clean: cleanTerminalText } = require('./lib/terminal-ui');
let terminalUI = null;

// One output owner while the full-screen UI is active. The plain CLI keeps its
// original output, while downloader messages become the live activity log.
function print(...args) {
  if (terminalUI?.active) terminalUI.log(...args);
  else console.log(...args);
}

function terminalWrite(text) {
  if (terminalUI?.active) {
    if (cleanTerminalText(text).trim()) terminalUI.log(text);
    return true;
  }
  return process.stdout.write(text);
}

function createProgressBar(label, options) {
  return terminalUI?.operation ? terminalUI.progress(label) : new cliProgress.SingleBar(options);
}

// ── App Version & Update Config ──
const APP_VERSION = '1.7.5';
const GITHUB_REPO = 'SMOKEx2/Zelux-DL';
const COOKIE_RELAY_PORT = 47821;
const COOKIE_RELAY_MAX_BYTES = 512 * 1024;


// Determine the base directory where config, downloads, and binaries should live.
// If packaged by pkg, use the directory containing the executable, otherwise use the directory of the script.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

process.on('uncaughtException', err => {
  terminalUI?.close();
  console.error(err.stack || String(err));
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
let MAX_PLAYLIST_ITEMS = 200;
let BATCH_CONCURRENCY = 2;
let HISTORY_LIMIT = 200;
let MEDIA_COOKIES_BROWSER = 'none';
let TEMP_MEDIA_COOKIES_FILE = '';
const MEDIA_COOKIE_BROWSERS = new Set(['none', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'safari', 'vivaldi', 'whale', 'chromium']);
const MEDIA_PROVIDERS = [
  ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'],
  ['vimeo.com', 'Vimeo'], ['tiktok.com', 'TikTok'], ['vm.tiktok.com', 'TikTok'], ['vt.tiktok.com', 'TikTok'],
  ['facebook.com', 'Facebook'], ['fb.watch', 'Facebook'],
  ['instagram.com', 'Instagram'], ['x.com', 'X/Twitter'], ['twitter.com', 'X/Twitter'],
  ['twitch.tv', 'Twitch'], ['dailymotion.com', 'Dailymotion'], ['dai.ly', 'Dailymotion'],
  ['soundcloud.com', 'SoundCloud'], ['bandcamp.com', 'Bandcamp'],
];

function getMediaProviderName(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return MEDIA_PROVIDERS.find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`))?.[1] || null;
  } catch (_) { return null; }
}

function buildMediaCookieArgs(browser, cookieFile) {
  const selectedBrowser = String(browser || 'none').toLowerCase();
  if (selectedBrowser !== 'none' && MEDIA_COOKIE_BROWSERS.has(selectedBrowser)) {
    return ['--cookies-from-browser', selectedBrowser];
  }
  return cookieFile ? ['--cookies', cookieFile] : [];
}

function toBoundedInteger(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function loadConfig() {
  const configPath = path.join(BASE_DIR, 'config.json');
  const defaults = {
    DOWNLOADS_DIR: "downloads",
    MAX_REDIRECTS: 15,
    TIMEOUT_MS: 60000,
    MAX_RETRIES: 3,
    NUM_CONNECTIONS: 16,
    MAX_PLAYLIST_ITEMS: 200,
    BATCH_CONCURRENCY: 2,
    HISTORY_LIMIT: 200,
    MEDIA_COOKIES_BROWSER: 'none'
  };

  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (userConfig.DOWNLOADS_DIR) {
        DOWNLOADS_DIR = path.isAbsolute(userConfig.DOWNLOADS_DIR) ? userConfig.DOWNLOADS_DIR : path.join(BASE_DIR, userConfig.DOWNLOADS_DIR);
      }
      MAX_REDIRECTS = toBoundedInteger(userConfig.MAX_REDIRECTS, defaults.MAX_REDIRECTS, 0, 50);
      TIMEOUT_MS = toBoundedInteger(userConfig.TIMEOUT_MS, defaults.TIMEOUT_MS, 1000, 600000);
      MAX_RETRIES = toBoundedInteger(userConfig.MAX_RETRIES, defaults.MAX_RETRIES, 0, 10);
      NUM_CONNECTIONS = toBoundedInteger(userConfig.NUM_CONNECTIONS, defaults.NUM_CONNECTIONS, 1, 32);
      MAX_PLAYLIST_ITEMS = toBoundedInteger(userConfig.MAX_PLAYLIST_ITEMS, defaults.MAX_PLAYLIST_ITEMS, 1, 5000);
      BATCH_CONCURRENCY = toBoundedInteger(userConfig.BATCH_CONCURRENCY, defaults.BATCH_CONCURRENCY, 1, 8);
      HISTORY_LIMIT = toBoundedInteger(userConfig.HISTORY_LIMIT, defaults.HISTORY_LIMIT, 10, 5000);
      const cookieBrowser = String(userConfig.MEDIA_COOKIES_BROWSER || 'none').toLowerCase();
      MEDIA_COOKIES_BROWSER = MEDIA_COOKIE_BROWSERS.has(cookieBrowser) ? cookieBrowser : 'none';
    } catch (e) {
      print(chalk.yellow('⚠️ ไม่สามารถอ่าน config.json ได้ จะใช้ค่าเริ่มต้นแทน'));
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

function getConfigSnapshot() {
  return {
    DOWNLOADS_DIR: path.relative(BASE_DIR, DOWNLOADS_DIR) || '.',
    MAX_REDIRECTS,
    TIMEOUT_MS,
    MAX_RETRIES,
    NUM_CONNECTIONS,
    MAX_PLAYLIST_ITEMS,
    BATCH_CONCURRENCY,
    HISTORY_LIMIT,
    MEDIA_COOKIES_BROWSER,
  };
}

function saveConfig() {
  const configPath = path.join(BASE_DIR, 'config.json');
  const tempPath = `${configPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(getConfigSnapshot(), null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, configPath);
}

function updateSetting(name, rawValue) {
  const key = String(name || '').toUpperCase();
  if (key === 'MEDIA_COOKIES_BROWSER') {
    const value = String(rawValue || '').trim().toLowerCase();
    if (!MEDIA_COOKIE_BROWSERS.has(value)) {
      throw new Error(`MEDIA_COOKIES_BROWSER must be one of: ${[...MEDIA_COOKIE_BROWSERS].join(', ')}`);
    }
    MEDIA_COOKIES_BROWSER = value;
    saveConfig();
    return value;
  }
  const specs = {
    MAX_REDIRECTS: [0, 50], TIMEOUT_MS: [1000, 600000], MAX_RETRIES: [0, 10],
    NUM_CONNECTIONS: [1, 32], MAX_PLAYLIST_ITEMS: [1, 5000],
    BATCH_CONCURRENCY: [1, 8], HISTORY_LIMIT: [10, 5000],
  };
  if (key === 'DOWNLOADS_DIR') {
    const value = String(rawValue || '').trim();
    if (!value) throw new Error('DOWNLOADS_DIR must not be empty');
    DOWNLOADS_DIR = path.isAbsolute(value) ? value : path.join(BASE_DIR, value);
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    saveConfig();
    return DOWNLOADS_DIR;
  }
  if (!specs[key]) throw new Error(`Unknown setting: ${key}`);
  const [min, max] = specs[key];
  const value = toBoundedInteger(rawValue, NaN, min, max);
  if (!Number.isSafeInteger(value)) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  ({ MAX_REDIRECTS, TIMEOUT_MS, MAX_RETRIES, NUM_CONNECTIONS, MAX_PLAYLIST_ITEMS, BATCH_CONCURRENCY, HISTORY_LIMIT } = {
    MAX_REDIRECTS, TIMEOUT_MS, MAX_RETRIES, NUM_CONNECTIONS, MAX_PLAYLIST_ITEMS, BATCH_CONCURRENCY, HISTORY_LIMIT,
    [key]: value,
  });
  saveConfig();
  return value;
}

const HISTORY_PATH = path.join(BASE_DIR, 'history.json');

function readHistory() {
  try {
    const value = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function writeHistory(entries) {
  const tempPath = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(entries.slice(-HISTORY_LIMIT), null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, HISTORY_PATH);
}

function addHistory(url) {
  const entries = readHistory();
  const entry = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    url,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  entries.push(entry);
  writeHistory(entries);
  return entry.id;
}

function finishHistory(id, result) {
  const entries = readHistory();
  const entry = entries.find(item => item.id === id);
  if (!entry) return;
  entry.status = result && result.success ? 'completed' : result && result.cancelled ? 'cancelled' : 'failed';
  entry.completedAt = new Date().toISOString();
  if (result && result.filePath) entry.filePath = result.filePath;
  if (result && result.error) entry.error = String(result.error).slice(0, 500);
  writeHistory(entries);
}

// Helper to auto-load cookies.txt if available
function getCookiesArgs() {
  if (TEMP_MEDIA_COOKIES_FILE && fs.existsSync(TEMP_MEDIA_COOKIES_FILE)) {
    return { str: ` --cookies "${TEMP_MEDIA_COOKIES_FILE}"`, arr: ['--cookies', TEMP_MEDIA_COOKIES_FILE] };
  }
  const cookiesPath = path.join(BASE_DIR, 'cookies.txt');
  const arr = buildMediaCookieArgs(MEDIA_COOKIES_BROWSER, fs.existsSync(cookiesPath) ? cookiesPath : '');
  return { str: arr.length ? ` ${arr.map(value => `"${value}"`).join(' ')}` : '', arr };
}

function formatFacebookCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) throw new Error('No Facebook cookies were provided.');
  const lines = ['# Netscape HTTP Cookie File', '# Temporary ZELUX-DL Facebook session'];
  let accepted = 0;
  for (const cookie of cookies) {
    const domain = String(cookie?.domain || '').toLowerCase();
    const name = String(cookie?.name || '');
    const value = String(cookie?.value || '');
    const cookiePath = String(cookie?.path || '/');
    if (!/^\.?([a-z0-9-]+\.)*facebook\.com$/.test(domain) || !name || !cookiePath.startsWith('/') || /[\t\r\n]/.test(domain + name + value + cookiePath)) continue;
    const expires = Number.isFinite(Number(cookie.expirationDate)) ? Math.floor(Number(cookie.expirationDate)) : 0;
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const cookieDomain = cookie.httpOnly ? `#HttpOnly_${domain}` : domain;
    lines.push(`${cookieDomain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expires}\t${name}\t${value}`);
    accepted += 1;
  }
  if (!accepted) throw new Error('No cookies for facebook.com were provided.');
  return `${lines.join('\n')}\n`;
}

function writeTemporaryFacebookCookies(cookies, directory = os.tmpdir()) {
  const contents = formatFacebookCookies(cookies);
  return writeTemporaryFacebookCookiesFromNetscape(contents, directory);
}

function writeTemporaryFacebookCookiesFromNetscape(contents, directory = os.tmpdir()) {
  const text = String(contents || '');
  if (!/^# Netscape HTTP Cookie File(?:\r?\n)/.test(text) || !/\n(?:#HttpOnly_)?\.?[\w.-]*facebook\.com\t/m.test(text)) {
    throw new Error('Temporary Facebook cookies are not in the expected Netscape format.');
  }
  const filePath = path.join(directory, `zelux-facebook-${crypto.randomBytes(16).toString('hex')}.txt`);
  fs.writeFileSync(filePath, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Windows ACLs inherit from the per-user temp directory. */ }
  return filePath;
}

function removeTemporaryFacebookCookies(filePath) {
  if (!filePath || !/^zelux-facebook-[a-f0-9]{32}\.txt$/i.test(path.basename(filePath))) return false;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (_) { return false; }
}

function isAllowedCookieRelayOrigin(origin) {
  const value = String(origin || '');
  // Chromium-based browsers normally use a 32-character a-p extension ID.
  // Accept valid extension-scheme host identifiers from Chromium forks too,
  // while never allowing ordinary web pages to access the cookie relay.
  return /^(?:chrome|brave|edge)-extension:\/\/[a-z0-9._-]{1,128}$/i.test(value)
    || /^moz-extension:\/\/[a-f0-9-]{36}$/i.test(value);
}

function cleanupStaleTemporaryFacebookCookies(directory = os.tmpdir(), now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^zelux-facebook-[a-f0-9]{32}\.txt$/i.test(entry.name)) continue;
      const filePath = path.join(directory, entry.name);
      try {
        if (now - fs.statSync(filePath).mtimeMs > maxAgeMs && removeTemporaryFacebookCookies(filePath)) removed += 1;
      } catch (_) { /* Ignore files in use or already removed. */ }
    }
  } catch (_) { /* Temp cleanup is best effort. */ }
  return removed;
}

function receiveTemporaryFacebookCookies(token, { port = COOKIE_RELAY_PORT, timeoutMs = 30000, onListening = () => {} } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) return Promise.reject(new Error('Invalid temporary cookie request token.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let receivedBytes = 0;
    let body = '';
    const server = http.createServer((request, response) => {
      const origin = String(request.headers.origin || '');
      const allowedOrigin = isAllowedCookieRelayOrigin(origin);
      // Some Chromium-based extension service workers omit Origin for loopback
      // requests. In that case the one-time token below remains mandatory for
      // POST /cookies; any present, non-extension Origin is still rejected.
      if (origin && !allowedOrigin) {
        response.writeHead(403, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        }).end(JSON.stringify({
          code: 'extension_origin_not_allowed',
          appVersion: APP_VERSION,
          origin: origin.slice(0, 256),
        }));
        return;
      }
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Zelux-Token');
      }
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'GET' && request.url.startsWith('/challenge?')) {
        const nonce = new URL(request.url, 'http://127.0.0.1').searchParams.get('nonce') || '';
        if (!/^[a-f0-9]{64}$/i.test(nonce)) {
          response.writeHead(400).end();
          return;
        }
        const proof = crypto.createHmac('sha256', Buffer.from(String(token), 'hex')).update(nonce, 'hex').digest('hex');
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ proof }));
        return;
      }
      if (request.method !== 'POST' || request.url !== '/cookies') {
        response.writeHead(404).end();
        return;
      }
      const suppliedToken = String(request.headers['x-zelux-token'] || '');
      const suppliedBuffer = Buffer.from(suppliedToken);
      const expectedBuffer = Buffer.from(String(token));
      if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
        response.writeHead(403).end();
        return;
      }
      const declaredSize = Number(request.headers['content-length'] || 0);
      if (declaredSize > COOKIE_RELAY_MAX_BYTES) {
        response.writeHead(413).end();
        settle(new Error('Temporary cookie payload is too large.'));
        request.resume();
        return;
      }
      request.setEncoding('utf8');
      request.on('data', chunk => {
        receivedBytes += Buffer.byteLength(chunk);
        if (receivedBytes > COOKIE_RELAY_MAX_BYTES) {
          response.writeHead(413).end();
          settle(new Error('Temporary cookie payload is too large.'));
          request.destroy();
          return;
        }
        body += chunk;
      });
      request.on('end', () => {
        if (settled) return;
        try {
          const payload = JSON.parse(body);
          const netscapeCookies = formatFacebookCookies(payload?.cookies);
          response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"accepted":true}');
          settle(null, netscapeCookies);
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'application/json' }).end('{"accepted":false}');
          settle(new Error(error.message || 'Invalid temporary cookie payload.'));
        }
      });
      request.on('error', error => settle(error));
    });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => {});
      error ? reject(error) : resolve(value);
    };
    const settle = finish;
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the browser extension to send temporary cookies.')), timeoutMs);
    server.once('error', error => finish(new Error(`Could not start the local cookie bridge: ${error.message}`)));
    server.once('listening', () => onListening(server.address().port));
    server.listen(port, '127.0.0.1');
  });
}

async function withTemporaryFacebookCookies(filePath, action) {
  const previous = TEMP_MEDIA_COOKIES_FILE;
  TEMP_MEDIA_COOKIES_FILE = filePath;
  try {
    return await action();
  } finally {
    TEMP_MEDIA_COOKIES_FILE = previous;
    removeTemporaryFacebookCookies(filePath);
  }
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

  terminalWrite('\x1b[?25l'); // hide cursor
  terminalWrite('\x1b[2J\x1b[3J\x1b[H'); // clear screen and scrollback buffer
  print(); // row 1 blank

  // print placeholder lines so they exist
  for (let r = 0; r < rows; r++) print();
  print(); // blank after logo

  const logoStartRow = 2; // 1-indexed, after blank line
  const totalFrames = 60;

  for (let f = 0; f < totalFrames; f++) {
    const hueOff = f * 8;

    // reposition cursor to logo start
    terminalWrite(`\x1b[${logoStartRow};1H`);

    for (let r = 0; r < rows; r++) {
      const lineHue = hueOff + r * 20;
      const colored = LOGO_PADDING + rainbowLine(LOGO[r], lineHue);
      // write + clear rest of line
      terminalWrite(colored + '\x1b[K\n');
    }

    await sleep(33); // ~30fps
  }

  terminalWrite('\x1b[?25h'); // show cursor
}

let currentView = 'default';

function renderScreen() {
  terminalWrite('\x1b[2J\x1b[3J\x1b[H'); // clear screen and scrollback buffer
  print();
  const hue = Math.floor(Date.now() / 5) % 360;
  for (let r = 0; r < LOGO.length; r++) {
    print(LOGO_PADDING + rainbowLine(LOGO[r], hue + r * 20));
  }
  print();

  switch (currentView) {
    case 'default':
      const displayDownloadsDir = DOWNLOADS_DIR.length > 22 ? '...' + DOWNLOADS_DIR.substring(DOWNLOADS_DIR.length - 19) : DOWNLOADS_DIR;
      print('       ' + chalk.hex('#38bdf8')('📁 โฟลเดอร์: ') + chalk.yellow.bold(displayDownloadsDir));
      print('       ' + chalk.hex('#fbbf24')('💡 Tip:') + dim(' วางหลาย URL เพื่อโหลด ') + chalk.green.bold('Batch'));
      print('       ' + chalk.hex('#fbbf24')('💡 Tip:') + dim(' พิมพ์ ') + chalk.magenta.bold('help') + dim(' เพื่อดูคำสั่งทั้งหมด'));
      const filesCount = fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR).filter(f => fs.statSync(path.join(DOWNLOADS_DIR, f)).isFile()).length : 0;
      print('       ' + chalk.hex('#a855f7')('📊 ประวัติ:') + dim(' ดาวน์โหลดสำเร็จแล้ว ') + chalk.magenta.bold(filesCount) + dim(' ไฟล์'));
      break;

    case 'help':
      print(chalk.hex('#f472b6').bold('    📖 คำสั่งที่ใช้ได้:'));
      print();
      print('    ' + chalk.hex('#60a5fa').bold('<URL>') + '             ' + chalk.white('วางลิงก์ดาวน์โหลดไฟล์'));
      print('    ' + chalk.hex('#34d399').bold('URLs...') + '           ' + chalk.white('วางหลายลิงก์โหลด Batch'));
      print('    ' + chalk.hex('#fbbf24').bold('list') + '              ' + chalk.white('ดูรายการไฟล์ที่โหลดแล้ว'));
      print('    ' + chalk.hex('#a78bfa').bold('clear') + '             ' + chalk.white('ล้างหน้าจอ'));
      print('    ' + chalk.hex('#2dd4bf').bold('open') + '              ' + chalk.white('เปิดโฟลเดอร์ downloads'));
      print('    ' + chalk.hex('#f59e0b').bold('update') + '            ' + chalk.white('อัปเดตyt-dlpให้เป็นเวอร์ชันล่าสุด'));
      print('    ' + chalk.hex('#10b981').bold('upgrade') + '           ' + chalk.white('อัปเดต ZELUX-DL ตัวเต็ม'));
      print('    ' + chalk.hex('#14b8a6').bold('check-update') + '      ' + chalk.white('ตรวจสอบเวอร์ชัน ZELUX-DL โดยไม่ติดตั้ง'));
      print('    ' + chalk.hex('#22d3ee').bold('settings') + '          ' + chalk.white('ดูการตั้งค่าปัจจุบัน'));
      print('    ' + chalk.hex('#22d3ee').bold('set KEY VALUE') + '     ' + chalk.white('เปลี่ยนการตั้งค่า'));
      print('    ' + chalk.hex('#fb7185').bold('history') + '           ' + chalk.white('ดูประวัติการดาวน์โหลด'));
      print('    ' + chalk.hex('#fb7185').bold('retry [failed|ID]') + ' ดูรายการที่ล้มเหลวแล้วลองใหม่');
      print('    ' + chalk.hex('#f472b6').bold('help') + '              ' + chalk.white('แสดงคำสั่งทั้งหมด'));
      print('    ' + chalk.hex('#f87171').bold('exit') + '              ' + chalk.white('ออกจากโปรแกรม'));
      print();
      print(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;

    case 'settings': {
      print(chalk.hex('#22d3ee').bold('    ⚙ Settings'));
      print();
      for (const [key, value] of Object.entries(getConfigSnapshot())) {
        print(`    ${chalk.cyan(key.padEnd(20))} ${chalk.yellow(String(value))}`);
      }
      print();
      print(dim('    ใช้: set KEY VALUE'));
      break;
    }

    case 'history': {
      const entries = readHistory().slice(-8).reverse();
      print(chalk.hex('#fb7185').bold('    Download History'));
      print();
      if (!entries.length) print(dim('    ยังไม่มีประวัติ'));
      for (const entry of entries) {
        const marker = entry.status === 'completed' ? success('✓') : entry.status === 'failed' ? error('✕') : warning('•');
        print(`    ${marker} ${chalk.cyan(entry.id)} ${dim(entry.status)} ${String(entry.url).slice(0, 34)}`);
      }
      print();
      print(dim('    ใช้: retry failed หรือ retry ID'));
      break;
    }

    case 'list':
      const files = fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR).filter(f => fs.statSync(path.join(DOWNLOADS_DIR, f)).isFile()) : [];
      if (files.length === 0) {
        print('    ' + chalk.hex('#94a3b8')('📭 ยังไม่มีไฟล์ที่ดาวน์โหลด'));
      } else {
        print('    ' + chalk.hex('#38bdf8').bold(`📁 ไฟล์ที่โหลดแล้ว (${files.length} ไฟล์):`));
        print();
        let tot = 0;
        const limit = 8;
        const showFiles = files.slice(0, limit);
        showFiles.forEach((f, i) => {
          const st = fs.statSync(path.join(DOWNLOADS_DIR, f));
          print(`    ${chalk.hex('#818cf8')((i + 1).toString().padStart(2) + '.')} ${chalk.cyan(f.length > 20 ? f.substring(0, 17) + '...' : f)}  ${chalk.yellow(formatBytes(st.size).padStart(9))}`);
        });

        files.forEach(f => {
          const st = fs.statSync(path.join(DOWNLOADS_DIR, f));
          tot += st.size;
        });

        if (files.length > limit) {
          print(`    ${dim('...')} และอีก ${files.length - limit} ไฟล์`);
        }
        print();
        print('    ' + chalk.hex('#fbbf24')('ขนาดรวม: ') + chalk.yellow.bold(formatBytes(tot)));
      }
      print();
      print(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;

    case 'open':
      print(lastOpenFolderResult?.success
        ? '    ' + success('✓') + ' Opened: ' + chalk.cyan(lastOpenFolderResult.directory)
        : '    ' + error('✕') + ' Could not open download folder: ' + (lastOpenFolderResult?.error || 'Unknown error'));
      print();
      print(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;

    case 'download':
      print('    ' + info('⚡') + chalk.hex('#60a5fa').bold(' กำลังดำเนินการดาวน์โหลด...'));
      break;

    case 'update':
      print('    ' + info('⚡') + chalk.hex('#60a5fa').bold(' กำลังดำเนินการตรวจสอบอัปเดต...'));
      break;

    case 'download-done':
      // This is shown as a footer when the downloads complete.
      print(chalk.hex('#818cf8')('    [ กด Enter เพื่อกลับหน้าหลัก ]'));
      break;
  }

  print();
  print('    ' + rainbowLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', Date.now() / 5));
  print();
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

function safeFilename(filename) {
  const cleaned = sanitizeFilename(path.basename(String(filename || '')))
    .replace(/[. ]+$/g, '')
    .slice(0, 240);
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return !cleaned || cleaned === '.' || cleaned === '..' || reserved.test(cleaned)
    ? `download_${Date.now()}`
    : cleaned;
}

function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
}

const LIBRARY_CATEGORIES = [
  ['Video', new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.mpeg', '.mpg'])],
  ['Audio', new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus'])],
  ['Archive', new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'])],
  ['Image', new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'])],
  ['Document', new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md'])],
  ['Application', new Set(['.exe', '.msi', '.apk', '.dmg', '.deb', '.rpm', '.appimage'])],
];

function categorizeLibraryFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return LIBRARY_CATEGORIES.find(([, extensions]) => extensions.has(extension))?.[0] || 'Other';
}

async function hashFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function buildSmartLibrary(directory, history = []) {
  const root = path.resolve(directory);
  const normalizeFilePath = filePath => {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const sources = new Map();
  for (const entry of history) {
    if (entry.status !== 'completed' || !entry.filePath) continue;
    sources.set(normalizeFilePath(entry.filePath), entry.url || '');
  }

  const files = [];
  async function walk(current) {
    let entries;
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(filePath); continue; }
      if (!entry.isFile() || /\.(?:part|tmp|crdownload)$/i.test(entry.name)) continue;
      try {
        const stat = await fs.promises.stat(filePath);
        files.push({
          name: entry.name,
          path: filePath,
          relativePath: path.relative(root, filePath),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          category: categorizeLibraryFile(filePath),
          source: sources.get(normalizeFilePath(filePath)) || '',
        });
      } catch (_) { /* Ignore files that disappear or become inaccessible during a scan. */ }
    }
  }
  await walk(root);

  const sameSize = new Map();
  for (const file of files) {
    if (!sameSize.has(file.size)) sameSize.set(file.size, []);
    sameSize.get(file.size).push(file);
  }
  const sameHash = new Map();
  for (const candidates of sameSize.values()) {
    if (candidates.length < 2) continue;
    for (const file of candidates) {
      try {
        file.sha256 = await hashFileSha256(file.path);
        const key = `${file.size}:${file.sha256}`;
        if (!sameHash.has(key)) sameHash.set(key, []);
        sameHash.get(key).push(file);
      } catch (_) { /* Keep the file visible even if it could not be hashed. */ }
    }
  }
  const duplicates = [...sameHash.values()].filter(group => group.length > 1);
  files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return {
    directory: root,
    files,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    categories: Object.fromEntries([...new Set([...LIBRARY_CATEGORIES.map(([name]) => name), 'Other'])]
      .map(name => [name, files.filter(file => file.category === name).length])),
    duplicates,
  };
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

function formatGitHubProgressLines(progress, payload, barSize = 33) {
  const filled = Math.round(progress * barSize);
  const rb = rainbowBar(filled, barSize - filled);
  const pct = (progress * 100).toFixed(1) + '%';
  const speed = String(payload.speed || '0 B/s');
  const eta = String(payload.eta || '--:--');
  const downloaded = String(payload.downloaded || '0 B').replace(/\s+/g, '');
  const total = String(payload.total || '0 B').replace(/\s+/g, '');
  return {
    barLine: `      ${rb} ${chalk.bold.white(pct.padStart(6))}`,
    statsLine: `      ${chalk.hex('#f472b6').bold(speed)} │ ${chalk.hex('#94a3b8')(`${downloaded}/${total}`)} │ ${chalk.hex('#34d399').bold(`ETA ${eta}`)}`,
  };
}

const reservedOutputPaths = new Set();
const reservedOutputDirectories = new Set();

function getUniqueFilePath(dir, filename) {
  let fp = path.join(dir, filename);
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let c = 1;
  while (fs.existsSync(fp) || reservedOutputPaths.has(path.resolve(fp))) {
    fp = path.join(dir, `${base} (${c})${ext}`);
    c++;
  }
  reservedOutputPaths.add(path.resolve(fp));
  return fp;
}

function getUniqueDirectoryPath(dir, dirname) {
  const safeName = safeFilename(dirname);
  let target = path.join(dir, safeName);
  let counter = 1;
  while (fs.existsSync(target) || reservedOutputDirectories.has(path.resolve(target))) {
    target = path.join(dir, `${safeName} (${counter})`);
    counter++;
  }
  reservedOutputDirectories.add(path.resolve(target));
  return target;
}

function removeDirectoryIfEmpty(dir, allowedRoot) {
  const root = path.resolve(allowedRoot);
  const target = path.resolve(dir);
  if (target === root || !target.startsWith(root + path.sep)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return false;
  if (fs.readdirSync(target).length !== 0) return false;
  fs.rmdirSync(target);
  return true;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

function extractGoogleFileId(parsed) {
  const pathMatch = parsed.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([a-z0-9_-]+)/i);
  const fileId = pathMatch?.[1] || parsed.searchParams.get('id');
  return fileId && /^[a-z0-9_-]{10,}$/i.test(fileId) ? fileId : null;
}

async function requestProviderPage(rawUrl, extraHeaders = {}) {
  const { res, finalUrl } = await httpRequest(rawUrl, extraHeaders);
  return new Promise((resolve, reject) => {
    let body = '';
    res.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        res.destroy();
        reject(new Error('หน้าแชร์มีขนาดใหญ่เกินไป'));
      }
    });
    res.on('end', () => resolve({ body, headers: res.headers, finalUrl, statusCode: res.statusCode }));
    res.on('error', reject);
  });
}

function diagnoseHttpResponse(statusCode, headers = {}, body = '', provider = 'ลิงก์') {
  const visible = String(body)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const challenge = /captcha|verify (?:that )?you are human|checking your browser|just a moment|turnstile|unusual traffic/i.test(visible);
  if (challenge) return `${provider} ต้องยืนยันผ่านเว็บ (CAPTCHA/เบราว์เซอร์) ก่อน ดาวน์โหลดอัตโนมัติไม่ได้ ให้เปิดลิงก์ในเบราว์เซอร์แล้วลองลิงก์ดาวน์โหลดตรง`;

  const authHeader = headers['www-authenticate'] || headers['WWW-Authenticate'];
  const loginPage = /log\s*in to (?:continue|download)|sign\s*in to (?:continue|download)|login required|authentication required|<input\b[^>]*type\s*=\s*["']?password/i.test(String(body));
  if (Number(statusCode) === 401 || authHeader || loginPage) {
    return `${provider} ต้องล็อกอินหรือไม่มี session ที่ใช้ได้ ให้เปิดลิงก์ในเบราว์เซอร์และตรวจว่าแชร์ไฟล์เป็นสาธารณะ`;
  }

  const status = Number(statusCode);
  if (status === 403) return `${provider} ปฏิเสธการเข้าถึง (HTTP 403) ตรวจสิทธิ์แชร์ ลิงก์สาธารณะ หรือข้อจำกัดของบัญชี`;
  if (status === 404 || status === 410) return `${provider} ไม่พบไฟล์ (HTTP ${status}) ลิงก์อาจถูกลบหรือหมดอายุ`;
  if (status === 429) return `${provider} จำกัดคำขอชั่วคราว (HTTP 429) รอสักครู่แล้วลองใหม่`;
  if (status >= 500) return `${provider} มีปัญหาฝั่งเซิร์ฟเวอร์ (HTTP ${status}) ลองใหม่ภายหลัง`;
  if (status >= 400) return `${provider} ตรวจลิงก์ไม่ผ่าน (HTTP ${status}) ตรวจ URL และสิทธิ์เข้าถึง`;
  return null;
}

function readResponseSnippet(res, maxBytes = 64 * 1024) {
  return new Promise(resolve => {
    let body = '', bytes = 0, settled = false;
    const finish = destroy => {
      if (settled) return;
      settled = true;
      res.removeListener('data', onData);
      res.removeListener('end', onEnd);
      res.removeListener('error', onEnd);
      res.removeListener('close', onEnd);
      if (destroy) res.destroy();
      resolve(body);
    };
    const onData = chunk => {
      bytes += chunk.length;
      body += chunk.toString('utf8');
      if (bytes >= maxBytes) finish(true);
    };
    const onEnd = () => finish(false);
    res.on('data', onData);
    res.once('end', onEnd);
    res.once('error', onEnd);
    res.once('close', onEnd);
  });
}

function parseSha256Metadata(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const candidates = [normalized['x-checksum-sha256'], normalized['x-amz-checksum-sha256']];
  const digest = String(normalized.digest || '');
  const digestValue = digest.match(/(?:^|,)\s*sha-?256\s*=\s*:?(?<value>[a-z0-9+/=_-]+):?/i)?.groups?.value;
  if (digestValue) candidates.push(digestValue);
  const googleHash = String(normalized['x-goog-hash'] || '').match(/(?:^|,)\s*sha256=(?<value>[a-z0-9+/=_-]+)/i)?.groups?.value;
  if (googleHash) candidates.push(googleHash);

  for (const candidate of candidates) {
    const value = String(candidate || '').trim().replace(/^sha-?256\s*[:=]\s*/i, '');
    if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
    if (/^[a-z0-9+/]{43}=$/i.test(value)) {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length === 32) return bytes.toString('hex');
    }
  }
  return null;
}

async function verifyDownloadIntegrity(filePath, { expectedSize = null, expectedSha256 = null } = {}) {
  const actualSize = fs.statSync(filePath).size;
  if (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && actualSize !== expectedSize) {
    throw new Error(`ขนาดไฟล์ไม่ตรงกับเซิร์ฟเวอร์ (คาดไว้ ${formatBytes(expectedSize)}, ได้ ${formatBytes(actualSize)}) ไฟล์อาจโหลดไม่ครบ`);
  }
  const sha256 = await calculateSHA256(filePath);
  if (expectedSha256 && sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error('SHA-256 ของไฟล์ไม่ตรงกับค่าที่ผู้ให้บริการแจ้ง ไฟล์อาจเสียหรือถูกเปลี่ยนแปลง');
  }
  return { size: actualSize, sha256 };
}

function getHtmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find(Boolean) || null;
}

function findProviderDownloadUrl(html, pageUrl) {
  const visibleHtml = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const tags = [...visibleHtml.matchAll(/<(a|button|form)\b([^>]*)>([\s\S]{0,512}?)(?:<\/\1>|$)/gi)];
  const candidates = [];
  for (const match of tags) {
    const tag = `<${match[1]}${match[2]}>`;
    const attrs = ['data-download-url', 'data-url', 'data-href', 'href', 'formaction', 'hx-get', 'onclick'];
    const values = attrs.map(name => getHtmlAttribute(tag, name)).filter(Boolean).map(decodeHtmlEntities);
    const downloadAttr = getHtmlAttribute(tag, 'download') !== null;
    const label = `${getHtmlAttribute(tag, 'id') || ''} ${getHtmlAttribute(tag, 'class') || ''} ${match[3]}`;
    const markedDownload = /download|direct|file[_-]?link/i.test(label) || downloadAttr;
    for (let value of values) {
      const jsTarget = value.match(/(?:location(?:\.href)?\s*=|open\()\s*['"]([^'"]+)['"]/i)?.[1];
      value = jsTarget || value;
      if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) continue;
      const candidate = new URL(value, pageUrl).href;
      const parsed = new URL(candidate);
      const page = new URL(pageUrl);
      const likelyFilePath = /\/(?:download|file|d)\b|\.(?:zip|rar|7z|iso|mp4|mkv|pdf)(?:$|\?)/i.test(parsed.pathname + parsed.search);
      const sameSite = parsed.hostname === page.hostname || parsed.hostname.endsWith(`.${page.hostname}`);
      if ((markedDownload && (sameSite || downloadAttr || /data-download-url|data-url/i.test(tag))) || (sameSite && likelyFilePath)) {
        candidates.push({ url: candidate, score: (downloadAttr ? 8 : 0) + (markedDownload ? 4 : 0) + (likelyFilePath ? 2 : 0) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || null;
}

async function resolveProviderPage(rawUrl, provider, fetchPage = requestProviderPage) {
  let response = await fetchPage(rawUrl);
  if (typeof response === 'string') response = { body: response, headers: {}, finalUrl: rawUrl };
  const pageUrl = response.finalUrl || rawUrl;
  const responseIssue = diagnoseHttpResponse(response.statusCode, response.headers, response.body, provider);
  if (responseIssue) throw new Error(responseIssue);
  const hxGet = String(response.body).match(/\bhx-get\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (hxGet) {
    const actionUrl = new URL(hxGet, pageUrl).href;
    const action = await fetchPage(actionUrl, { 'HX-Request': 'true', 'HX-Current-URL': pageUrl });
    if (action?.headers?.['hx-redirect']) {
      return { provider, url: new URL(action.headers['hx-redirect'], pageUrl).href };
    }
    if (action?.headers?.['HX-Redirect']) {
      return { provider, url: new URL(action.headers['HX-Redirect'], pageUrl).href };
    }
    if (typeof action === 'string') response = { ...response, body: action };
    else if (action?.body) response = action;
  }
  const directUrl = findProviderDownloadUrl(response.body, pageUrl);
  if (directUrl) return { provider, url: directUrl };
  const visibleText = String(response.body).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  const challenge = /captcha|verify (?:that )?you are human|checking your browser|just a moment|turnstile/i.test(visibleText);
  throw new Error(challenge
    ? `${provider} ต้องยืนยันผ่านเว็บก่อน จึงยังดึงลิงก์อัตโนมัติไม่ได้`
    : `${provider} ไม่พบปุ่มหรือลิงก์ดาวน์โหลดในหน้าแชร์ ลิงก์อาจหมดอายุหรือต้องใช้ session จากเบราว์เซอร์`);
}

async function resolveDownloadProvider(rawUrl, fetchPage = requestProviderPage) {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'drive.google.com' || hostname === 'docs.google.com') {
    const fileId = extractGoogleFileId(parsed);
    if (!fileId) throw new Error('ไม่พบ File ID ในลิงก์ Google Drive');

    if (/\/document\/d\//i.test(parsed.pathname)) {
      return { provider: 'Google Docs', url: `https://docs.google.com/document/d/${fileId}/export?format=docx` };
    }
    if (/\/spreadsheets\/d\//i.test(parsed.pathname)) {
      return { provider: 'Google Sheets', url: `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx` };
    }
    if (/\/presentation\/d\//i.test(parsed.pathname)) {
      return { provider: 'Google Slides', url: `https://docs.google.com/presentation/d/${fileId}/export/pptx` };
    }
    return {
      provider: 'Google Drive',
      url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    };
  }

  if (hostname === 'drive.usercontent.google.com') {
    return { provider: 'Google Drive', url: parsed.href };
  }

  if (hostname === 'dropbox.com' || hostname.endsWith('.dropbox.com')) {
    parsed.searchParams.delete('raw');
    parsed.searchParams.set('dl', '1');
    return { provider: 'Dropbox', url: parsed.href };
  }

  if (hostname === 'pixeldrain.com' || hostname === 'www.pixeldrain.com') {
    const match = parsed.pathname.match(/^\/(?:u|file)\/([a-z0-9_-]+)\/?$/i);
    if (match) {
      return { provider: 'Pixeldrain', url: `https://pixeldrain.com/api/file/${encodeURIComponent(match[1])}?download` };
    }
    if (parsed.pathname.startsWith('/api/file/')) return { provider: 'Pixeldrain', url: parsed.href };
  }

  // vik1ngfile.site embeds its files on the canonical vikingfile.com host.
  // Normalize it before probing so the downloader follows the real file route.
  if (hostname === 'vik1ngfile.site' || hostname === 'www.vik1ngfile.site') {
    parsed.hostname = 'vikingfile.com';
    return resolveProviderPage(parsed.href, 'VikingFile', fetchPage);
  }

  // Resolve downloadable links exposed by public hoster pages.
  const directFileHosts = [
    ['1filez.com', '1Filez'],
    ['rootz.so', 'Rootz'],
    ['buzzheavier.com', 'BuzzHeavier'],
    ['buzzheavier.net', 'BuzzHeavier'],
    ['datanodes.to', 'DataNodes'],
    ['filemirage.com', 'FileMirage'],
    ['filemirage.net', 'FileMirage'],
  ];
  const directFileHost = directFileHosts.find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (directFileHost) return resolveProviderPage(parsed.href, directFileHost[1], fetchPage);

  if (hostname === 'filekeeper.net' || hostname.endsWith('.filekeeper.net')) {
    return { provider: 'FileKeeper', url: parsed.href };
  }
  if (hostname === 'fileditchfiles.st' || hostname.endsWith('.fileditchfiles.st')) {
    return { provider: 'FileDitchFiles', url: parsed.href };
  }

  if (hostname === 'huggingface.co') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const blobIndex = segments.indexOf('blob');
    if (blobIndex >= 2 && blobIndex < segments.length - 1) {
      segments[blobIndex] = 'resolve';
      parsed.pathname = '/' + segments.map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
      parsed.searchParams.set('download', 'true');
    }
    return { provider: 'Hugging Face', url: parsed.href };
  }

  if (hostname === 'mediafire.com' || hostname.endsWith('.mediafire.com')) {
    if (hostname.startsWith('download')) return { provider: 'MediaFire', url: parsed.href };
    const page = await fetchPage(parsed.href);
    if (typeof page !== 'string') {
      const responseIssue = diagnoseHttpResponse(page.statusCode, page.headers, page.body, 'MediaFire');
      if (responseIssue) throw new Error(responseIssue);
    }
    const html = typeof page === 'string' ? page : page.body;
    const button = html.match(/<a\b[^>]*\bid=["']downloadButton["'][^>]*>/i)?.[0];
    const direct = button?.match(/\bhref=["']([^"']+)["']/i)?.[1]
      || html.match(/https:\/\/download[^"'\s<>]+\.mediafire\.com\/[^"'\s<>]+/i)?.[0];
    if (!direct) throw new Error('MediaFire ไม่ส่งลิงก์ไฟล์ (ไฟล์อาจถูกล็อกหรือลบแล้ว)');
    return { provider: 'MediaFire', url: decodeHtmlEntities(direct) };
  }

  if (hostname === '1drv.ms' || hostname === 'onedrive.live.com' || hostname.endsWith('.sharepoint.com')) {
    parsed.searchParams.set('download', '1');
    return { provider: hostname.endsWith('.sharepoint.com') ? 'SharePoint' : 'OneDrive', url: parsed.href };
  }

  if (hostname === 'github.com' || hostname === 'raw.githubusercontent.com' || hostname === 'codeload.github.com') {
    return { provider: 'GitHub', url: parsed.href };
  }

  const mediaProvider = getMediaProviderName(parsed.href);
  if (mediaProvider) return { provider: mediaProvider, url: parsed.href };

  return { provider: 'Direct HTTP', url: parsed.href };
}

function parseGitHubRepositoryUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol) || !['github.com', 'codeload.github.com'].includes(hostname)) return null;
    const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/i, '');
    const validSegment = /^[a-z0-9_.-]+$/i;
    if (!validSegment.test(owner) || !validSegment.test(repo) || !repo) return null;

    if (hostname === 'github.com' && segments.length === 2) return { owner, repo };

    let ref = null;
    if (hostname === 'github.com' && segments[2] === 'archive') {
      if (segments[3] === 'refs' && ['heads', 'tags'].includes(segments[4]) && segments.length >= 6) {
        ref = segments.slice(5).join('/').replace(/\.zip$/i, '');
      } else if (segments.length === 4) {
        ref = segments[3].replace(/\.zip$/i, '');
      }
    } else if (hostname === 'codeload.github.com' && segments[2] === 'zip') {
      if (segments[3] === 'refs' && ['heads', 'tags'].includes(segments[4]) && segments.length >= 6) {
        ref = segments.slice(5).join('/').replace(/\.zip$/i, '');
      } else if (segments.length === 4) {
        ref = segments[3].replace(/\.zip$/i, '');
      }
    }

    return ref ? { owner, repo, ref } : null;
  } catch (_) {
    return null;
  }
}

function decodeZeluxProtocolArg(value) {
  const decoded = decodeZeluxProtocolArgs(value);
  return decoded[0] || String(value || '').trim();
}

function decodeZeluxProtocolRequest(value) {
  const raw = String(value || '').trim();
  if (!/^zelux:/i.test(raw)) return { urls: raw ? [raw] : [], cookieToken: '', exePath: '' };

  try {
    const protocolUrl = new URL(raw);
    if (protocolUrl.hostname.toLowerCase() === 'download') {
      const encodedList = protocolUrl.searchParams.get('urls');
      let urls = [];
      if (encodedList) {
        const parsedList = JSON.parse(encodedList);
        if (Array.isArray(parsedList)) urls = parsedList.map(item => String(item || '').trim()).filter(isValidUrl);
      } else {
        const targetUrl = protocolUrl.searchParams.get('url');
        if (targetUrl && isValidUrl(targetUrl)) urls = [targetUrl];
      }
      const token = String(protocolUrl.searchParams.get('cookieToken') || '');
      return {
        urls,
        cookieToken: /^[a-f0-9]{64}$/i.test(token) ? token : '',
        exePath: String(protocolUrl.searchParams.get('exePath') || ''),
      };
    }
  } catch (_) { }

  // Keep links from extension versions before 2.1 working.
  let legacy = raw.replace(/^zelux:\/\//i, '');
  legacy = legacy.replace(/^(https?)\/\//i, '$1://');
  try { legacy = decodeURIComponent(legacy); } catch (_) { }
  return { urls: (legacy.match(/https?:\/\/[^\s<>"']+/gi) || []).filter(isValidUrl), cookieToken: '', exePath: '' };
}

function normalizeZeluxExePath(value) {
  const candidate = String(value || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '\\');
  if (!/^[a-z]:\\(?:[^<>:"|?*\u0000-\u001f\\]+\\)*zelux-dl\.exe$/i.test(candidate)) return '';
  return path.win32.normalize(candidate);
}

function verifyZeluxExeIdentity(exePath) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "$i=[Diagnostics.FileVersionInfo]::GetVersionInfo($env:ZELUX_EXE_PATH); [Console]::WriteLine($i.ProductName + '|' + $i.OriginalFilename + '|' + $i.FileVersion)";
  let identity;
  try {
    identity = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, ZELUX_EXE_PATH: exePath },
    }).trim().split('|');
  } catch (_) {
    throw new Error('Could not verify this EXE. Choose the ZELUX-DL.exe distributed by the ZELUX-DL release.');
  }
  if (identity.length !== 3 || identity[0] !== 'ZELUX-DL' || identity[1] !== 'ZELUX-DL.exe' || !/^\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/.test(identity[2])) {
    throw new Error('This file is not a verified ZELUX-DL.exe. Choose the executable distributed by the ZELUX-DL release.');
  }
  return identity[2];
}

function startConfiguredZeluxProcess(exePath, protocolArg) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    '$exe = $env:ZELUX_TARGET_EXE',
    '$arg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZELUX_PROTOCOL_ARG_BASE64))',
    `$quotedArg = '"' + $arg.Replace('"', '\\"') + '"'`,
    '$child = Start-Process -FilePath $exe -ArgumentList $quotedArg -WorkingDirectory ([IO.Path]::GetDirectoryName($exe)) -PassThru -WindowStyle Normal',
    `if (-not $child -or $child.Id -le 0) { throw 'Windows did not start the configured ZELUX-DL process.' }`,
    '[Console]::WriteLine($child.Id)',
  ].join('; ');
  const output = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    env: {
      ...process.env,
      ZELUX_TARGET_EXE: exePath,
      ZELUX_PROTOCOL_ARG_BASE64: Buffer.from(String(protocolArg || ''), 'utf8').toString('base64'),
    },
  });
  const childPid = Number(String(output || '').trim());
  if (!Number.isSafeInteger(childPid) || childPid <= 0) {
    throw new Error('Windows did not confirm that the configured ZELUX-DL process started.');
  }
  return childPid;
}

async function handoffToConfiguredZeluxExe(exePathValue, protocolArg, dependencies = {}) {
  const exePath = normalizeZeluxExePath(exePathValue);
  if (!exePath) throw new Error('Invalid app path. Configure an absolute Windows path ending in ZELUX-DL.exe.');
  const platform = dependencies.platform || process.platform;
  if (platform !== 'win32') throw new Error('The configured ZELUX-DL.exe path can only be used on Windows.');

  let fileInfo;
  try { fileInfo = (dependencies.statFile || fs.statSync)(exePath); }
  catch (_) { throw new Error(`ZELUX-DL.exe was not found at ${exePath}. Update the extension settings with its current location.`); }
  if (!fileInfo.isFile()) throw new Error('The configured ZELUX-DL.exe path is not a file.');

  const currentPath = path.win32.resolve(dependencies.currentExePath || process.execPath).toLowerCase();
  if (path.win32.resolve(exePath).toLowerCase() === currentPath) return false;
  (dependencies.verifyIdentity || verifyZeluxExeIdentity)(exePath);

  const startProcess = dependencies.startProcess || startConfiguredZeluxProcess;
  await startProcess(exePath, protocolArg);
  return true;
}

function decodeZeluxProtocolArgs(value) {
  const raw = String(value || '').trim();
  if (!/^zelux:/i.test(raw)) return raw ? [raw] : [];
  return decodeZeluxProtocolRequest(raw).urls;
}

function extractUrlsFromText(value) {
  const values = Array.isArray(value) ? value : [value];
  const found = [];
  const seen = new Set();

  for (const item of values) {
    const candidates = /^zelux:/i.test(String(item || '').trim())
      ? decodeZeluxProtocolArgs(item)
      : [String(item || '')];

    for (const candidate of candidates) {
      const matches = String(candidate).match(/https?:\/\/[^\s<>"']+/gi) || [];
      for (let url of matches) {
        // Remove punctuation commonly left behind when links are pasted from prose.
        url = url.replace(/[),;]+$/g, '');
        if (isValidUrl(url) && !seen.has(url)) {
          seen.add(url);
          found.push(url);
        }
      }
    }
  }

  return found;
}

function buildGitHubArchiveUrl(repository, branch) {
  const encodePath = value => String(value).split('/').map(encodeURIComponent).join('/');
  return `https://codeload.github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/zip/refs/heads/${encodePath(branch)}`;
}

function buildGitHubRawUrl(repository, ref, filePath) {
  const encodePath = value => String(value).split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/${encodeURIComponent(ref)}/${encodePath(filePath)}`;
}

function summarizeGitHubTree(payload) {
  if (!payload || !Array.isArray(payload.tree)) throw new Error('GitHub tree response is invalid');
  if (payload.truncated) throw new Error('GitHub tree is too large and was truncated');
  const files = payload.tree.filter(entry =>
    entry && entry.type === 'blob' && entry.mode !== '120000' &&
    typeof entry.path === 'string' && Number.isSafeInteger(entry.size) && entry.size >= 0
  );
  if (files.length === 0) throw new Error('GitHub repository has no downloadable files');
  return { files, totalSize: files.reduce((sum, entry) => sum + entry.size, 0) };
}

function planGitHubRangeTasks(files, totalSize, maxConnections) {
  const limit = Math.max(1, Math.min(toBoundedInteger(maxConnections, 1, 1, 32), 32));
  const targetChunkSize = Math.max(1, Math.ceil(Math.max(1, totalSize) / limit));
  const tasks = [];
  const chunkCounts = new Map();

  for (const entry of files) {
    if (entry.size === 0) {
      chunkCounts.set(entry.path, 0);
      continue;
    }
    const chunkCount = entry.size > 1024 * 1024
      ? Math.min(limit, Math.max(1, Math.ceil(entry.size / targetChunkSize)))
      : 1;
    const chunkSize = Math.ceil(entry.size / chunkCount);
    chunkCounts.set(entry.path, chunkCount);
    for (let partIndex = 0; partIndex < chunkCount; partIndex++) {
      const start = partIndex * chunkSize;
      const end = Math.min(entry.size - 1, start + chunkSize - 1);
      tasks.push({ entry, partIndex, start, end, length: end - start + 1 });
    }
  }

  return {
    tasks,
    chunkCounts,
    connectionCount: Math.max(1, Math.min(limit, tasks.length || 1)),
  };
}

async function mergeRangeParts(partPaths, destination, controller) {
  const output = fs.createWriteStream(destination, { flags: 'wx' });
  activeWriteStreams.add(output);
  output.once('close', () => activeWriteStreams.delete(output));
  try {
    for (const partPath of partPaths) {
      const input = fs.createReadStream(partPath);
      for await (const chunk of input) {
        if (controller.cancelled) throw new Error('CANCELLED');
        if (!output.write(chunk)) await once(output, 'drain');
      }
    }
    output.end();
    await once(output, 'finish');
    for (const partPath of partPaths) fs.unlinkSync(partPath);
  } catch (error) {
    output.destroy();
    try { fs.unlinkSync(destination); } catch (_) { }
    throw error;
  }
}

function resolveZipEntryPath(destination, entryName) {
  if (typeof entryName !== 'string' || entryName.includes('\0')) throw new Error('ZIP entry name ไม่ถูกต้อง');
  const normalized = entryName.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || segments.includes('..')) {
    throw new Error(`ZIP entry พยายามเขียนออกนอกโฟลเดอร์: ${entryName}`);
  }
  const root = path.resolve(destination);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`ZIP entry พยายามเขียนออกนอกโฟลเดอร์: ${entryName}`);
  }
  return target;
}

function extractZipSafely(zipPath, destination, onEntry = () => {}) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError) return reject(openError);
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        try { zipFile.close(); } catch (_) { }
        reject(error);
      };

      zipFile.on('error', fail);
      zipFile.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zipFile.on('entry', entry => {
        let outputPath;
        try {
          outputPath = resolveZipEntryPath(destination, entry.fileName);
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((unixMode & 0o170000) === 0o120000) throw new Error(`ไม่อนุญาต symlink ใน ZIP: ${entry.fileName}`);
        } catch (error) {
          fail(error);
          return;
        }

        if (entry.fileName.endsWith('/')) {
          fs.mkdirSync(outputPath, { recursive: true });
          onEntry(entry);
          zipFile.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        zipFile.openReadStream(entry, (streamError, readStream) => {
          if (streamError) return fail(streamError);
          const writeStream = fs.createWriteStream(outputPath, { flags: 'wx' });
          const streamFail = error => {
            try { writeStream.destroy(); } catch (_) { }
            try { readStream.destroy(); } catch (_) { }
            fail(error);
          };
          readStream.on('error', streamFail);
          writeStream.on('error', streamFail);
          writeStream.on('finish', () => {
            if (settled) return;
            onEntry(entry);
            zipFile.readEntry();
          });
          readStream.pipe(writeStream);
        });
      });
      zipFile.readEntry();
    });
  });
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
const activeWriteStreams = new Set();

function abortAllDownloads() {
  for (const item of activeRequests) {
    try {
      item.destroy();
    } catch (e) { }
  }
  for (const stream of activeWriteStreams) {
    try { stream.destroy(new Error('CANCELLED')); } catch (_) { }
  }
}

function removeTreeBottomUp(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  for (const entry of fs.readdirSync(target)) {
    removeTreeBottomUp(path.join(target, entry));
  }
  fs.rmdirSync(target);
}

async function removeTreeWithRetries(target, allowedRoot, attempts = 20) {
  const root = path.resolve(allowedRoot);
  const resolved = path.resolve(target);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to clean path outside download root: ${resolved}`);
  }

  const streamDeadline = Date.now() + 3000;
  while (activeWriteStreams.size > 0 && Date.now() < streamDeadline) {
    await sleep(50);
  }

  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!fs.existsSync(resolved)) return true;
    try {
      removeTreeBottomUp(resolved);
    } catch (err) {
      lastError = err;
    }
    if (!fs.existsSync(resolved)) return true;
    await sleep(Math.min(100 + attempt * 50, 500));
  }
  throw new Error(`ลบไฟล์ที่ยกเลิกไม่สำเร็จ: ${lastError?.message || resolved}`);
}

function isCancelInput(key) {
  const input = String(key || '');
  return input === '\x1b' || input === '\x1b[27;1;27~' || input.includes('\x03');
}

// ── Download Cancel Controller ──
class CancelController {
  constructor() {
    this.cancelled = false;
    this.childProcesses = new Set();
    this.cancelCallbacks = new Set();
    this._onKey = null;
    this._listenerCount = 0;
  }

  onCancel(callback) {
    if (this.cancelled) {
      callback();
      return () => { };
    }
    this.cancelCallbacks.add(callback);
    return () => this.cancelCallbacks.delete(callback);
  }

  // Start listening for Escape/Ctrl+C during download
  startListening() {
    this._listenerCount++;
    if (this._listenerCount > 1) return;
    if (!terminalUI?.operation) this.cancelled = false;
    // The full-screen UI owns keyboard input, including Escape. Installing a
    // second raw listener would deliver Escape again after readline's timeout.
    if (terminalUI?.active) return;
    const stdin = process.stdin;
    if (!stdin.isTTY || !stdin.setRawMode) return;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    this._onKey = (key) => {
      // Escape key = \x1b (without [ following = standalone Escape)
      // Ctrl+C = \x03
      if (isCancelInput(key)) {
        terminalWrite('\r\x1b[K\n      Cancelling active downloads...\n');
        this.cancel();
      }
    };
    stdin.on('data', this._onKey);
  }

  // Stop listening
  stopListening() {
    this._listenerCount = Math.max(0, this._listenerCount - 1);
    if (this._listenerCount > 0) return;
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
    for (const childProcess of this.childProcesses) {
      try {
        if (process.platform === 'win32') {
          // On Windows, use taskkill to kill the process tree
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${childProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
          childProcess.kill('SIGKILL');
        }
      } catch (e) { }
    }
    this.childProcesses.clear();

    for (const callback of this.cancelCallbacks) {
      try { callback(); } catch (_) { }
    }
    this.cancelCallbacks.clear();

    // Abort all HTTP connections
    abortAllDownloads();
  }
}

const cancelCtrl = new CancelController();

// ── HTTP request with redirect ──
function httpRequest(rawUrl, extraHeaders = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) return reject(new Error('Redirect มากเกินไป'));
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
        res.once('close', () => activeRequests.delete(res));
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
    const statusCode = res.statusCode;
    const headers = res.headers;
    const contentType = headers['content-type'] || 'unknown';
    const isHtml = /text\/html/i.test(contentType);
    const snippet = statusCode >= 400 || isHtml ? await readResponseSnippet(res) : (res.destroy(), '');
    const responseIssue = diagnoseHttpResponse(statusCode, headers, snippet);
    if (responseIssue) {
      const err = new Error(responseIssue);
      err.statusCode = statusCode;
      throw err;
    }

    const acceptRanges = statusCode === 206 || headers['accept-ranges'] === 'bytes';
    let totalSize = 0;
    if (statusCode === 206 && headers['content-range']) {
      const m = headers['content-range'].match(/\/(\d+)/);
      if (m) totalSize = parseInt(m[1], 10);
    } else {
      totalSize = parseInt(headers['content-length'], 10) || 0;
    }
    const filename = extractFilename(finalUrl, headers);
    if (isHtml && !/attachment/i.test(headers['content-disposition'] || '') && !/\.x?html?$/i.test(filename)) {
      throw new Error(`ปลายทางส่งหน้าเว็บ HTML แทนไฟล์ (${filename}) ลิงก์นี้อาจยังไม่ใช่ลิงก์ดาวน์โหลดตรง หรือเว็บต้องให้ล็อกอิน/ยืนยันผ่านเบราว์เซอร์`);
    }
    return {
      finalUrl, acceptRanges, totalSize, filename, contentType, statusCode,
      expectedSha256: parseSha256Metadata(headers),
    };
  } catch (err) {
    const isTemporary = err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode < 600) || !err.statusCode;
    if (isTemporary && retryCount < MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
      print(`  ${warning('⚠')} เชื่อมต่อล้มเหลว (${err.message}) — กำลังลองใหม่ใน ${(delay / 1000).toFixed(1)} วินาที... (${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return probeFileInfo(url, retryCount + 1);
    }
    throw err;
  }
}

// ── Download a range to file ──
function downloadRange(url, start, end, dest, onData, retryCount = 0, showRetryLogs = true, controller = cancelCtrl) {
  const task = new Promise((resolve, reject) => {
    if (controller.cancelled) return reject(new Error('CANCELLED'));

    const extra = {};
    const ranged = start !== undefined && end !== undefined;
    let existingSize = ranged && fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (ranged && existingSize > end - start + 1) {
      fs.truncateSync(dest, 0);
      existingSize = 0;
    }
    const resumeStart = ranged ? start + existingSize : start;
    if (ranged && resumeStart > end) return resolve(existingSize);
    if (ranged) extra['Range'] = `bytes=${resumeStart}-${end}`;

    httpRequest(url, extra).then(({ res }) => {
      if (controller.cancelled) return reject(new Error('CANCELLED'));
      if (res.statusCode >= 400) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        throw err;
      }
      if (ranged && res.statusCode !== 206) {
        res.resume();
        const err = new Error('Server ignored the resume range');
        err.statusCode = res.statusCode;
        throw err;
      }
      if (ranged) {
        const contentStart = Number((res.headers['content-range'] || '').match(/^bytes (\d+)-/i)?.[1]);
        if (!Number.isSafeInteger(contentStart) || contentStart !== resumeStart) {
          res.resume();
          throw new Error('Server returned an invalid resume range');
        }
      }
      const ws = fs.createWriteStream(dest, { flags: existingSize > 0 ? 'a' : 'w' });
      activeWriteStreams.add(ws);
      ws.once('close', () => activeWriteStreams.delete(ws));
      res.on('data', chunk => {
        if (controller.cancelled) { ws.destroy(); res.destroy(); reject(new Error('CANCELLED')); return; }
        onData(chunk.length);
      });
      res.pipe(ws);
      ws.on('finish', () => resolve(existingSize));
      ws.on('error', reject);
      res.on('aborted', () => { ws.destroy(); reject(controller.cancelled ? new Error('CANCELLED') : new Error('Download response was aborted')); });
      res.on('close', () => {
        if (!res.complete) {
          ws.destroy();
          reject(controller.cancelled ? new Error('CANCELLED') : new Error('Download connection closed early'));
        }
      });
      res.on('error', err => { ws.destroy(); reject(err); });
    }).catch(async (err) => {
      if (controller.cancelled) return reject(new Error('CANCELLED'));
      const isTemporary = err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode < 600) || !err.statusCode;
      if (isTemporary && retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
        if (showRetryLogs) {
          terminalWrite('\r\x1b[K');
          print(`  ${warning('⚠')} ดาวน์โหลดขัดข้อง (${err.message}) — กำลังลองใหม่ใน ${(delay / 1000).toFixed(1)} วินาที... (${retryCount + 1}/${MAX_RETRIES})`);
        }
        await sleep(delay);
        if (controller.cancelled) return reject(new Error('CANCELLED'));
        downloadRange(url, start, end, dest, onData, retryCount + 1, showRetryLogs, controller).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
  let unsubscribe = () => { };
  const cancelled = new Promise((resolve, reject) => {
    unsubscribe = controller.onCancel(() => reject(new Error('CANCELLED')));
  });
  return Promise.race([task, cancelled]).finally(() => unsubscribe());
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

async function cleanupDownloadArtifacts(filePath, connectionCount = 1, allowedRoot = DOWNLOADS_DIR) {
  const targets = new Set([filePath, `${filePath}.part`, ...Array.from({ length: connectionCount }, (_, i) => `${filePath}.part${i}`)]);
  const directory = path.dirname(filePath);
  const escapedName = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const chunkPattern = new RegExp(`^${escapedName}\\.part\\d+$`, 'i');
  try {
    for (const name of fs.readdirSync(directory)) {
      if (chunkPattern.test(name)) targets.add(path.join(directory, name));
    }
  } catch (_) { /* directory may already be gone */ }
  const deadline = Date.now() + 5000;
  while (activeWriteStreams.size > 0 && Date.now() < deadline) await sleep(50);
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    try {
      await removeTreeWithRetries(target, allowedRoot, 8);
    } catch (err) {
      throw new Error(`ลบไฟล์ดาวน์โหลดที่ค้างไม่สำเร็จ (${path.basename(target)}): ${err.message}`);
    }
  }
  return [...targets].every(target => !fs.existsSync(target));
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

function isMediaExtractorUrl(urlStr) {
  return Boolean(getMediaProviderName(urlStr));
}

function shouldUseMediaExtractor(urlStr, contentType = '') {
  return isMediaExtractorUrl(urlStr)
    || String(urlStr || '').toLowerCase().includes('.m3u8')
    || /(?:text\/html|application\/xhtml\+xml)/i.test(String(contentType || ''));
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
  if (terminalUI?.active) return terminalUI.choose(options, headerText);
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

    terminalWrite('\x1b[?25l');

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
      terminalWrite(out);
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
        terminalWrite(`\r\x1b[${options.length}A\x1b[J`);
        resolve(options[selectedIndex].value);
      }
    }

    function redrawMenu() {
      terminalWrite(`\r\x1b[${options.length}A\x1b[J`);
      drawMenu();
    }

    function cleanup() {
      stdin.removeListener('keypress', onKeypress);
      if (stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause();
      terminalWrite('\x1b[?25h');
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
    print('      ' + warning('⚡ ไม่พบ FFmpeg ในระบบ — กำลังดาวน์โหลด FFmpeg อัตโนมัติ...'));
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
    const headers = {
      'User-Agent': 'ZELUX-DL/' + APP_VERSION,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Accept-Encoding': 'identity',
    };
    https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchJSON(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', chunk => {
          if (errorBody.length < 2048) errorBody += chunk;
        });
        res.on('end', () => {
          let detail = '';
          try { detail = JSON.parse(errorBody).message || ''; } catch (_) { }
          const remaining = res.headers['x-ratelimit-remaining'];
          const rate = remaining !== undefined ? `; rate remaining ${remaining}` : '';
          reject(new Error(`HTTP ${res.statusCode}${detail ? `: ${detail}` : ''}${rate}`));
        });
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

function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const headers = buildHeaders(url);
    https.get(url, { headers }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, url).href, redirectCount + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 1024 * 1024) res.destroy(new Error('Response too large'));
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
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

function findChecksum(checksumText, assetName) {
  const line = String(checksumText).split(/\r?\n/).find(item => item.trim().endsWith(assetName));
  const hash = line && line.trim().split(/\s+/)[0].toLowerCase();
  return hash && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function waitForUpdateHelperReady(child, logPath, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let interval;
    let timeout;
    const finish = err => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve();
    };
    const checkLog = () => {
      try {
        if (fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').includes('Updater started; waiting for process')) {
          finish();
          return true;
        }
      } catch (_) { /* The helper may still be creating its log. */ }
      return false;
    };

    child.once('error', err => finish(new Error(`PowerShell updater could not start: ${err.message}`)));
    child.once('exit', (code, signal) => {
      if (!settled && !checkLog()) {
        finish(new Error(`PowerShell updater exited before it was ready (code ${code}, signal ${signal || 'none'}).`));
      }
    });
    interval = setInterval(checkLog, 100);
    timeout = setTimeout(() => finish(new Error(`PowerShell updater did not report ready within ${Math.ceil(timeoutMs / 1000)} seconds.`)), timeoutMs);
    checkLog();
  });
}

// Check GitHub for a newer release. Returns { available, latest, downloadUrl, releaseNotes } or null
async function checkForUpdate() {
  if (!GITHUB_REPO) return null;
  try {
    const release = await fetchJSON(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const latestTag = release.tag_name; // e.g. "v1.1.0"
    if (compareVersions(latestTag, APP_VERSION) > 0) {
      // Find the right asset for this platform
      const exeName = process.platform === 'win32' ? 'ZELUX-DL.exe' : 'ZELUX-DL-linux';
      const asset = release.assets.find(a => a.name.toLowerCase() === exeName.toLowerCase());
      const checksumAsset = release.assets.find(a => a.name.toLowerCase() === 'sha256sums.txt');
      return {
        available: true,
        latest: latestTag,
        current: APP_VERSION,
        downloadUrl: asset ? asset.browser_download_url : null,
        assetName: asset ? asset.name : null,
        checksumUrl: checksumAsset ? checksumAsset.browser_download_url : null,
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
  // A source checkout runs under node.exe; never replace the Node runtime.
  if (!process.pkg) {
    print('Source mode: update this checkout with Git, or run upgrade from ZELUX-DL.exe.');
    return false;
  }
  print();
  print('    ' + info('🔍') + ' กำลังตรวจสอบเวอร์ชันล่าสุด...');

  const update = await checkForUpdate();

  if (!update) {
    if (!GITHUB_REPO) {
      print('    ' + warning('⚠️') + ' ยังไม่ได้ตั้งค่า GitHub repo');
      print('    ' + dim('    แก้ไข GITHUB_REPO ใน zelux.js เป็น ') + chalk.cyan("'username/ZELUX-DL'"));
    } else {
      print('    ' + error('✕') + ' ไม่สามารถเชื่อมต่อ GitHub ได้');
    }
    print();
    return false;
  }

  if (!update.available) {
    print('    ' + success('✓') + chalk.green.bold(` คุณใช้เวอร์ชันล่าสุดแล้ว! (v${update.current})`));
    print();
    return false;
  }

  print('    ' + chalk.hex('#fbbf24')('🎉') + chalk.yellow.bold(` พบเวอร์ชันใหม่! v${update.current} → ${update.latest}`));
  if (update.releaseNotes) {
    print('    ' + dim('    ' + update.releaseNotes.split('\n')[0]));
  }

  if (!update.downloadUrl) {
    print('    ' + error('✕') + ' ไม่พบไฟล์ดาวน์โหลดสำหรับระบบนี้');
    print();
    return false;
  }

  print('    ' + info('⬇️') + ' กำลังดาวน์โหลด ' + chalk.cyan(update.latest) + '...');

  const exePath = process.execPath;
  const tempPath = exePath + '.update';
  const backupPath = exePath + '.backup';

  try {
    // Download new version to temp file
    await downloadFile(update.downloadUrl, tempPath);

    if (!update.checksumUrl) throw new Error('Release does not include SHA256SUMS.txt');
    const checksumText = await fetchText(update.checksumUrl);
    const expectedHash = findChecksum(checksumText, update.assetName);
    if (!expectedHash) throw new Error('Invalid release checksum');
    const actualHash = await calculateSHA256(tempPath);
    if (actualHash.toLowerCase() !== expectedHash) throw new Error('Update checksum verification failed');

    if (process.platform === 'win32') {
      // Windows locks the running EXE. The detached helper waits for this PID,
      // retries replacement, verifies the installed version, then relaunches.
      const helperDir = path.join(process.env.LOCALAPPDATA || BASE_DIR, 'ZELUX-DL');
      fs.mkdirSync(helperDir, { recursive: true });
      const scriptPath = path.join(helperDir, '_update.ps1');
      const logPath = path.join(helperDir, '_update.log');
      fs.writeFileSync(scriptPath, buildWindowsUpdateScript(), 'utf8');
      fs.writeFileSync(logPath, '', 'utf8');

      print();
      print('    ' + success('✓') + chalk.green.bold(' ดาวน์โหลดสำเร็จ! กำลังอัปเดต...'));
      print('    ' + dim('    โปรแกรมจะรอปิดตัวเดิม ตรวจ EXE ใหม่ แล้วเปิดขึ้นอีกครั้ง'));
      print('    ' + dim('    หากเปิดไม่สำเร็จ ตรวจ log ใน %LOCALAPPDATA%\\ZELUX-DL\\_update.log'));
      print();

      const { spawn } = require('child_process');
      await new Promise((resolve, reject) => {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const powershellExe = fs.existsSync(powershellPath) ? powershellPath : 'powershell.exe';
        const child = spawn(powershellExe, [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
          '-File', scriptPath,
          '-ParentPid', String(process.pid),
          '-ExePath', exePath,
          '-TempPath', tempPath,
          '-BackupPath', backupPath,
          '-WorkDir', BASE_DIR,
          '-LogPath', logPath,
          '-ExpectedVersion', update.latest.replace(/^v/i, ''),
        ], { cwd: BASE_DIR, detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', reject);
        child.once('spawn', async () => {
          try {
            await waitForUpdateHelperReady(child, logPath);
            child.unref();
            resolve();
          } catch (err) {
            try { child.kill(); } catch (_) { }
            reject(err);
          }
        });
      });

      // Releasing our PID is what allows PowerShell to replace the EXE safely.
      process.exit(0);
    } else {
      // On Linux/macOS, we can replace the file directly
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(exePath, backupPath);
      fs.renameSync(tempPath, exePath);
      fs.chmodSync(exePath, '755');

      const { spawn } = require('child_process');
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(exePath, [], { cwd: BASE_DIR, detached: true, stdio: 'ignore' });
          child.once('error', reject);
          child.once('spawn', () => { child.unref(); resolve(); });
        });
      } catch (launchError) {
        try {
          fs.unlinkSync(exePath);
          fs.renameSync(backupPath, exePath);
        } catch (_) { }
        throw new Error(`อัปเดตแล้วแต่เปิดโปรแกรมใหม่ไม่สำเร็จ: ${launchError.message}`);
      }
      try { fs.unlinkSync(backupPath); } catch (_) { }

      print();
      print('    ' + success('✓') + chalk.green.bold(' อัปเดตสำเร็จ! กำลังเปิดโปรแกรมใหม่...'));
      print();
      await sleep(500);
      process.exit(0);
    }
  } catch (e) {
    print('    ' + error('✕') + ' อัปเดตล้มเหลว: ' + e.message);
    // Cleanup temp file
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) { }
    print();
    return false;
  }
}

// ── Check &amp; retrieve yt-dlp path, downloading automatically if missing ──
const getYtDlpPath = async () => {
  // Keep the managed binary separate so an older running yt-dlp cannot lock updates.
  const binaryName = process.platform === 'win32' ? 'yt-dlp-current.exe' : 'yt-dlp-current';
  const localPath = path.join(BASE_DIR, binaryName);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  try {
    print('      ' + warning(`⚡ ไม่พบ yt-dlp — กำลังดาวน์โหลด yt-dlp ล่าสุดอัตโนมัติ...`));
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

function parseYtDlpProgressLine(rawLine) {
  const line = String(rawLine || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  const item = line.match(/\[download\]\s+Downloading\s+item\s+(\d+)\s+of\s+(\d+)/i);
  if (item) return { type: 'item', current: Number(item[1]), total: Number(item[2]) };

  const progress = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([^\s]+)\s+at\s+(.+?)\s+ETA\s+([^\s]+)/i);
  if (progress) {
    return {
      type: 'progress',
      percent: Number(progress[1]),
      size: progress[2],
      speed: progress[3].trim(),
      eta: progress[4],
    };
  }

  if (/\[ExtractAudio\]|\[Merger\]|has already been downloaded/i.test(line)) return { type: 'completed' };
  if (/^ERROR:/i.test(line)) return { type: 'error', message: line };
  return null;
}

// Keep startup responsive when GitHub is slow or offline. A notification is
// useful, but it must never block the downloader for more than two seconds.
async function checkForUpdateQuickly(timeoutMs = 2000) {
  return Promise.race([
    checkForUpdate(),
    sleep(timeoutMs).then(() => null),
  ]);
}

function printUpdateStatus(update) {
  if (!update) {
    print('    ' + dim('ℹ ไม่สามารถตรวจสอบอัปเดตได้ในขณะนี้'));
    return;
  }
  if (update.available) {
    print('    ' + chalk.hex('#fbbf24')('🎉') + chalk.yellow.bold(` มีเวอร์ชันใหม่ ${update.latest} (ปัจจุบัน v${update.current})`));
    print('    ' + dim('พิมพ์ upgrade เพื่อดาวน์โหลดและติดตั้งอัตโนมัติ'));
  } else {
    print('    ' + success('✓') + chalk.green(` ใช้เวอร์ชันล่าสุดแล้ว (v${update.current})`));
  }
}

function buildWindowsUpdateScript() {
  return String.raw`param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$TempPath,
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Value "[$(Get-Date -Format s)] $Message"
}
try {
  Write-UpdateLog "Updater started; waiting for process $ParentPid to exit."
  $Deadline = (Get-Date).AddSeconds(45)
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $Deadline) { throw 'Timed out waiting for the old program to exit.' }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $TempPath -PathType Leaf)) { throw 'The verified update file is missing.' }
  Write-UpdateLog 'Verified update file exists; preparing executable replacement.'
  if (Test-Path -LiteralPath $BackupPath) { Remove-Item -LiteralPath $BackupPath -Force }
  $Replaced = $false
  for ($Attempt = 1; $Attempt -le 20; $Attempt++) {
    try {
      if (Test-Path -LiteralPath $ExePath) { Move-Item -LiteralPath $ExePath -Destination $BackupPath -Force }
      Move-Item -LiteralPath $TempPath -Destination $ExePath -Force
      $Replaced = $true
      break
    } catch {
      if (-not (Test-Path -LiteralPath $ExePath) -and (Test-Path -LiteralPath $BackupPath)) {
        Move-Item -LiteralPath $BackupPath -Destination $ExePath -Force
      }
      if ($Attempt -eq 20) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $Replaced) { throw 'Could not replace the executable.' }
  Write-UpdateLog 'Executable replaced; checking installed version.'
  $ActualVersion = (& $ExePath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $ActualVersion -ne $ExpectedVersion) {
    throw "Installed executable version check failed. Expected $ExpectedVersion, got $ActualVersion."
  }
  Write-UpdateLog "Installed and verified version $ActualVersion. Launching."
  $NewProcess = Start-Process -FilePath $ExePath -WorkingDirectory $WorkDir -PassThru
  Start-Sleep -Seconds 2
  if (-not (Get-Process -Id $NewProcess.Id -ErrorAction SilentlyContinue)) {
    throw 'The updated program exited shortly after launch.'
  }
  if (Test-Path -LiteralPath $BackupPath) {
    try { Remove-Item -LiteralPath $BackupPath -Force } catch { Write-UpdateLog "Could not remove backup: $($_.Exception.Message)" }
  }
  Write-UpdateLog "Version $ActualVersion is running."
} catch {
  Write-UpdateLog "Update/relaunch failed: $($_.Exception.Message)"
  if (Test-Path -LiteralPath $BackupPath) {
    try {
      if (Test-Path -LiteralPath $ExePath) { Remove-Item -LiteralPath $ExePath -Force }
      Move-Item -LiteralPath $BackupPath -Destination $ExePath -Force
      Write-UpdateLog 'Restored the previous executable and reopening it.'
      Start-Process -FilePath $ExePath -WorkingDirectory $WorkDir
    } catch { Write-UpdateLog "Rollback/relaunch failed: $($_.Exception.Message)" }
  }
}`;
}

async function downloadMediaFile(url) {
  print('      ' + info('\u27F3') + ' กำลังเตรียมระบบดาวน์โหลดสื่อ...');

  const ytdlpPath = await getYtDlpPath();
  if (!ytdlpPath) {
    print('      ' + error('\u2715') + ' ไม่พบ yt-dlp ในระบบและไม่สามารถดาวน์โหลดได้');
    print();
    return { success: false, error: 'yt-dlp is unavailable' };
  }

  const ffmpegPath = await getFfmpegPath();

  if (!isValidUrl(url)) {
    print('      ' + error('\u2715') + ' ลิงก์ไม่รองรับ');
    print();
    return { success: false, error: 'Unsupported URL' };
  }

  print('      ' + info('\u27F3') + ' กำลังตรวจสอบข้อมูลสื่อ...');

  let isPlaylist = false;
  let playlistTitle = '';
  let entriesCount = 1;
  let metadata = null;

  try {
    const getFlatMetadata = (ytdlp, targetUrl) => {
      return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        const args = ['--dump-json', '--flat-playlist', '--js-runtimes', 'node', ...getCookiesArgs().arr, targetUrl];
        execFile(ytdlp, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
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
        // จำกัดจำนวนเพลงใน playlist (ป้องกัน Mix playlist ที่มีเพลงเป็นพันๆ)
        if (entriesCount > MAX_PLAYLIST_ITEMS) {
          const originalCount = entriesCount;
          entriesCount = MAX_PLAYLIST_ITEMS;
          print('      ' + warning(`⚠️  Playlist มี ${originalCount} รายการ — จำกัดไว้ที่ ${MAX_PLAYLIST_ITEMS} รายการ`));
        }
      } else {
        metadata = firstEntry;
      }
    }
  } catch (err) {
    print('      ' + error('\u2715') + ' ไม่สามารถตรวจสอบข้อมูลลิงก์ได้: ' + err.message);
    const mediaProvider = getMediaProviderName(url);
    if (['TikTok', 'Facebook'].includes(mediaProvider)) {
      print('      ' + dim('ลองตั้งค่า MEDIA_COOKIES_BROWSER เป็น browser ที่ล็อกอินอยู่ หรือพิมพ์ update เพื่ออัปเดต yt-dlp'));
      print('      ' + dim('ใช้ได้เฉพาะเนื้อหาที่บัญชีของคุณเข้าถึงได้ ไม่ข้าม private, DRM หรือข้อจำกัดสิทธิ์'));
    }
    print();
    return { success: false, error: err.message };
  }

  // If it's a single video, fetch its full metadata for precise size/quality info
  if (!isPlaylist) {
    try {
      const getFullMetadata = (ytdlp, targetUrl) => {
        return new Promise((resolve, reject) => {
          const { execFile } = require('child_process');
          const args = ['--dump-json', '--js-runtimes', 'node', '--no-playlist', ...getCookiesArgs().arr, targetUrl];
          execFile(ytdlp, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
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
    { label: '🎬 MP4 (วิดีโอพร้อมเสียง)', value: 'mp4' },
    { label: '🎵 MP3 (เสียงเท่านั้น)', value: 'mp3' }
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

  print('      ' + success('\u2713') + ' เชื่อมต่อสำเร็จ!');
  if (formatType === 'mp4' && !isMuxed) {
    print('      ' + warning('⚠️  ไม่พบ FFmpeg ในระบบ (สลับใช้สตรีมรวมสูงสุด 720p แทน)'));
  }
  if (formatType === 'mp3' && !ffmpegPath) {
    print('      ' + warning('⚠️  ไม่พบ FFmpeg ในระบบ (บันทึกเป็นไฟล์เสียงดิบ .m4a แทน .mp3)'));
  }
  print();

  if (isPlaylist) {
    const displayTitle = title.length > 25 ? title.substring(0, 22) + '...' : title;
    print('      ' + white('📄 เพลย์ลิสต์: ') + chalk.cyan(displayTitle));
    print('      ' + white('📦 จำนวน: ') + chalk.yellow(`${entriesCount} วิดีโอ`));
  } else {
    const displayFilename = filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
    print('      ' + white('📄 ไฟล์: ') + chalk.cyan(displayFilename));
    print('      ' + white('📦 ขนาด: ') + (totalSize > 0 ? chalk.yellow(formatBytes(totalSize)) : dim('ไม่ทราบ')));
  }

  let mimeStr = formatType === 'mp3' ? (ffmpegPath ? 'audio/mp3' : 'audio/mp4') : 'video/mp4';
  print('      ' + white('📝 ชนิด: ') + dim(mimeStr));

  const qualStr = formatType === 'mp3' ? 'audio/best' : (isMuxed ? (selectedQuality === 'best' ? (metadata?.height ? `${metadata.height}p` : 'Best Available') : `${selectedQuality}p`) : 'best (~720p)');
  print('      ' + white('✨ คุณภาพ: ') + chalk.hex('#10b981').bold(qualStr));

  if (isPlaylist) {
    print('      ' + white('📁 โฟลเดอร์: ') + chalk.yellow.bold(path.join(subfolderName, sanitizeFilename(title))));
  } else {
    print('      ' + white('📁 โฟลเดอร์: ') + chalk.yellow.bold(subfolderName));
  }
  print();

  let isFirstFrame = true;
  const barSize = 33;
  const bar = createProgressBar(title || filename || 'Media download', {
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
  print('      ' + dim('(กด Esc เพื่อยกเลิก)'));

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
    args.push('--playlist-end', String(MAX_PLAYLIST_ITEMS));
  }

  if (ffmpegPath) {
    args.push('--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg');
  }

  // ทะลวงลิมิตความเร็วของ YouTube โดยใช้เทคนิคการโหลดพร้อมกันหลายท่อ (Multi-connection for DASH/HLS)
  const mediaProviderName = getMediaProviderName(url);
  if (isPlaylist) {
    // Playlist: ลดความเร็วลงเพื่อป้องกัน YouTube rate-limit
    args.push('--concurrent-fragments', '4');
    args.push('--sleep-interval', '2', '--max-sleep-interval', '5');
  } else if (['TikTok', 'Facebook'].includes(mediaProviderName)) {
    // TikTok and Facebook may throttle highly parallel fragment requests.
    args.push('--concurrent-fragments', '4');
  } else {
    args.push('--concurrent-fragments', '16');
  }

  const cookieArgs = getCookiesArgs().arr;
  if (cookieArgs.length > 0) args.push(...cookieArgs);
  args.push('--newline', '--progress', '--js-runtimes', 'node', '-o', filePath, url);

  const { spawn } = require('child_process');

  // Start cancel listener
  cancelCtrl.startListening();

  try {
    const warningMsg = await new Promise((resolve, reject) => {
      const child = spawn(ytdlpPath, args);
      cancelCtrl.childProcesses.add(child);
      let stderrData = '';
      let currentItem = 1;
      let totalItems = entriesCount;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const handleProgressLine = (line) => {
        const event = parseYtDlpProgressLine(line);
        if (!event) return;

        if (event.type === 'item') {
          currentItem = event.current;
          totalItems = event.total;
          const value = isPlaylist ? Math.max(0, currentItem - 1) / totalItems : 0;
          bar.update(value, {
            speed: 'Preparing...',
            downloaded: `(${currentItem}/${totalItems}) กำลังเตรียม`,
            total: '??',
            eta_formatted: '--:--',
          });
          return;
        }

        if (event.type === 'progress') {
          const value = isPlaylist
            ? (currentItem - 1 + event.percent / 100) / totalItems
            : event.percent / 100;
          bar.update(value, {
            speed: event.speed,
            downloaded: isPlaylist ? `(${currentItem}/${totalItems}) ${event.percent.toFixed(1)}%` : `${event.percent.toFixed(1)}%`,
            total: event.size,
            eta_formatted: event.eta,
          });
          return;
        }

        if (event.type === 'completed') {
          bar.update(isPlaylist ? currentItem / totalItems : 1, {
            speed: 'Processing...',
            downloaded: isPlaylist ? `(${currentItem}/${totalItems}) 100%` : '100%',
            total: totalSize > 0 ? formatBytes(totalSize) : '??',
            eta_formatted: '00:00',
          });
        }
      };

      const consumeLines = (data, isStderr = false) => {
        const combined = (isStderr ? stderrBuffer : stdoutBuffer) + data.toString();
        const lines = combined.split(/\r\n|\n|\r/);
        const remainder = lines.pop() || '';
        if (isStderr) stderrBuffer = remainder;
        else stdoutBuffer = remainder;
        for (const line of lines) handleProgressLine(line);
      };

      child.stdout.on('data', (data) => {
        consumeLines(data);
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
        consumeLines(data, true);
      });

      child.on('close', async (code) => {
        cancelCtrl.childProcesses.delete(child);
        if (stdoutBuffer) handleProgressLine(stdoutBuffer);
        if (stderrBuffer) handleProgressLine(stderrBuffer);
        if (cancelCtrl.cancelled) {
          return reject(new Error('CANCELLED'));
        }
        if (code === 0) {
          const ignoredErrors = stderrData.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.startsWith('ERROR:'))
            .join(' | ');
          resolve(ignoredErrors || undefined);
        }
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

    let completedPlaylistItems = entriesCount;
    if (isPlaylist) {
      try {
        completedPlaylistItems = fs.readdirSync(targetDir)
          .filter(name => path.extname(name).toLowerCase() === extension.toLowerCase())
          .length;
      } catch (_) {
        completedPlaylistItems = 0;
      }
    }

    const finalProgress = isPlaylist && warningMsg
      ? Math.min(1, completedPlaylistItems / entriesCount)
      : 1;

    bar.update(finalProgress, {
      speed: warningMsg ? '⚠ Errors' : '✓ Done!',
      downloaded: isPlaylist
        ? `(${completedPlaylistItems}/${entriesCount}) ${(finalProgress * 100).toFixed(1)}%`
        : '100%',
      total: totalSize > 0 ? formatBytes(totalSize) : '??',
      eta_formatted: '00:00'
    });
    bar.stop();

    if (isPlaylist && warningMsg && completedPlaylistItems === 0) {
      try {
        for (const name of fs.readdirSync(targetDir)) {
          if (/\.(?:webp|jpg|jpeg|png)$/i.test(name)) fs.unlinkSync(path.join(targetDir, name));
        }
      } catch (_) { }
      throw new Error(`Playlist โหลดไม่สำเร็จ: ${warningMsg}`);
    }

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
      terminalWrite('      ' + dim('🔒 กำลังคำนวณ SHA256...'));
      hash = await calculateSHA256(filePath);
      terminalWrite('\r\x1b[K');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgSpd = finalDownloadedBytes / ((Date.now() - startTime) / 1000);

    print();
    print('    ' + rainbowLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', Date.now() / 5));
    if (isPlaylist && warningMsg) {
      print('      ' + warning.bold('⚠️ ดาวน์โหลดเสร็จสิ้น (มีบางไฟล์ขัดข้อง)'));
      print('      ' + dim(warningMsg.length > 150 ? warningMsg.substring(0, 147) + '...' : warningMsg));
    } else {
      print('      ' + success.bold('✓ ดาวน์โหลดเสร็จสิ้น!'));
    }
    print('      ' + dim('ขนาด      : ') + chalk.yellow(formatBytes(finalDownloadedBytes)));
    print('      ' + dim('เวลา      : ') + chalk.yellow(elapsed + ' วินาที'));
    print('      ' + dim('เฉลี่ย     : ') + chalk.hex('#818cf8')(formatSpeed(avgSpd)));

    if (isPlaylist) {
      const relativeSavedPath = path.join('downloads', subfolderName, sanitizeFilename(title));
      const displayFilePath = relativeSavedPath.length > 30 ? '...' + relativeSavedPath.substring(relativeSavedPath.length - 27) : relativeSavedPath;
      print('      ' + dim('โฟลเดอร์   : ') + chalk.cyan(displayFilePath));
      print('      ' + dim('จำนวน     : ') + chalk.yellow(`${completedPlaylistItems}/${entriesCount} ไฟล์`));
    } else {
      const relativeSavedPath = path.join('downloads', subfolderName, filename);
      const displayFilePath = relativeSavedPath.length > 30 ? '...' + relativeSavedPath.substring(relativeSavedPath.length - 27) : relativeSavedPath;
      print('      ' + dim('บันทึก    : ') + chalk.cyan(displayFilePath));
      const displayHash = hash.substring(0, 12) + '...' + hash.substring(hash.length - 12);
      print('      ' + dim('SHA256    : ') + accent(displayHash));
    }
    print('    ' + rainbowLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', Date.now() / 5));
    print();

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

    return { success: true, filePath: isPlaylist ? targetDir : filePath };

  } catch (err) {
    cancelCtrl.stopListening();
    bar.stop();

    if (err.message === 'CANCELLED') {
      abortAllDownloads();
      terminalWrite('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      print('      ' + warning.bold('⚠️ ยกเลิกแล้ว — เก็บเพลงที่เสร็จและไฟล์ .part ไว้โหลดต่อ'));
      print();
      return { success: false, cancelled: true, cleanupFailed: false, error: 'Cancelled' };
    } else {
      terminalWrite('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      print('      ' + error('✕') + ' ดาวน์โหลดล้มเหลว: ' + err.message);
      print();
      return { success: false, error: err.message };
    }
  }
}

// ── Download a single file ──
async function downloadGitHubRepositoryArchive(url, repository) {
  print('      ' + info('GitHub') + ` ${chalk.cyan(`${repository.owner}/${repository.repo}`)}`);
  const archiveUrl = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/archive/HEAD.zip`;
  print('      ' + dim('GitHub จะเลือก default branch ให้อัตโนมัติ'));
  print('      ' + dim('กำลังดาวน์โหลด repository archive...'));

  const archiveResult = await performDownload(archiveUrl);
  if (!archiveResult?.success || !archiveResult.filePath) return archiveResult;

  const archivePath = archiveResult.filePath;
  const stagingDir = fs.mkdtempSync(path.join(DOWNLOADS_DIR, '.zelux-github-'));
  const targetDir = getUniqueDirectoryPath(DOWNLOADS_DIR, repository.repo);
  let extractedEntries = 0;

  try {
    print('      ' + info('ZIP') + ' กำลังแตกไฟล์แบบ streaming...');
    await extractZipSafely(archivePath, stagingDir, () => { extractedEntries++; });

    const topLevel = fs.readdirSync(stagingDir, { withFileTypes: true });
    if (topLevel.length === 1 && topLevel[0].isDirectory()) {
      fs.renameSync(path.join(stagingDir, topLevel[0].name), targetDir);
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      for (const entry of topLevel) {
        fs.renameSync(path.join(stagingDir, entry.name), path.join(targetDir, entry.name));
      }
    }

    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.unlinkSync(archivePath);
    removeDirectoryIfEmpty(path.dirname(archivePath), DOWNLOADS_DIR);
    print('      ' + success('✓') + ` แตกไฟล์สำเร็จ ${chalk.yellow(extractedEntries)} รายการ`);
    print('      ' + dim('บันทึกที่: ') + chalk.cyan(targetDir));
    print();
    return { success: true, filePath: targetDir, repository: `${repository.owner}/${repository.repo}` };
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`แตกไฟล์ GitHub repository ไม่สำเร็จ: ${err.message}`);
  }
}

async function downloadGitHubRepositoryMulti(repository, branch, files, totalSize) {
  const targetDir = getUniqueDirectoryPath(DOWNLOADS_DIR, repository.repo);
  fs.mkdirSync(targetDir, { recursive: true });

  const rangePlan = planGitHubRangeTasks(files, totalSize, NUM_CONNECTIONS);
  const connectionCount = rangePlan.connectionCount;
  const activePartials = new Map();
  const completedChunks = new Map();
  let completedBytes = 0;
  let completedFiles = 0;
  let nextTaskIndex = 0;
  let firstError = null;
  let lastBytes = 0;
  let lastTime = Date.now();
  let currentSpeed = 0;
  const startTime = Date.now();

  print('      ' + success('✓') + ` พบ ${chalk.yellow(files.length)} ไฟล์`);
  print('      ' + white('📦 ขนาดรวม: ') + chalk.yellow(formatBytes(totalSize)));
  print('      ' + white('🔗 Mode: ') + chalk.green.bold(`${connectionCount}x GitHub Ranged`));
  print('      ' + dim('(กด Esc เพื่อยกเลิก)'));
  print();

  let isFirstProgressFrame = true;
  const barSize = 33;
  const bar = createProgressBar(`${repository.owner}/${repository.repo}`, {
    format: (options, params, payload) => {
      const lines = formatGitHubProgressLines(params.progress, payload, barSize);
      if (isFirstProgressFrame) {
        isFirstProgressFrame = false;
        return `${lines.barLine}\n${lines.statsLine}`;
      }
      return `\x1b[1A\r${lines.barLine}\x1b[K\n${lines.statsLine}\x1b[K`;
    },
    barsize: barSize,
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: false,
    forceRedraw: true,
  });

  bar.start(totalSize || 1, 0, {
    speed: '0 B/s',
    downloaded: '0 B',
    total: formatBytes(totalSize),
    eta: '--:--',
    files: `0/${files.length}`,
  });

  const redrawTimer = setInterval(() => {
    let downloadedBytes = completedBytes;
    for (const partial of activePartials.values()) {
      try { downloadedBytes += fs.statSync(partial).size; } catch (_) { }
    }
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed >= 0.3) {
      currentSpeed = Math.max(0, (downloadedBytes - lastBytes) / elapsed);
      lastBytes = downloadedBytes;
      lastTime = now;
    }
    const eta = currentSpeed > 0 ? (totalSize - downloadedBytes) / currentSpeed : 0;
    bar.update(Math.min(downloadedBytes, totalSize || 1), {
      speed: formatSpeed(currentSpeed),
      downloaded: formatBytes(downloadedBytes),
      total: formatBytes(totalSize),
      eta: formatETA(eta),
      files: `${completedFiles}/${files.length}`,
    });
  }, 100);

  cancelCtrl.startListening();

  for (const entry of files) {
    if (entry.size !== 0) continue;
    const destination = resolveZipEntryPath(targetDir, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, '');
    completedFiles++;
  }

  const worker = async () => {
    while (!firstError && !cancelCtrl.cancelled) {
      const taskIndex = nextTaskIndex++;
      if (taskIndex >= rangePlan.tasks.length) return;
      const task = rangePlan.tasks[taskIndex];
      const entry = task.entry;
      try {
        const destination = resolveZipEntryPath(targetDir, entry.path);
        const partial = `${destination}.zelux-part${task.partIndex}`;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const rawUrl = buildGitHubRawUrl(repository, branch, entry.path);
        activePartials.set(taskIndex, partial);
        await downloadRange(rawUrl, task.start, task.end, partial, () => { }, 0, false);
        const actualSize = fs.statSync(partial).size;
        if (actualSize !== task.length) {
          throw new Error(`ขนาด chunk ไม่ตรง: ${entry.path} (${actualSize}/${task.length})`);
        }
        activePartials.delete(taskIndex);
        completedBytes += task.length;

        const finished = (completedChunks.get(entry.path) || 0) + 1;
        completedChunks.set(entry.path, finished);
        const chunkCount = rangePlan.chunkCounts.get(entry.path);
        if (finished === chunkCount) {
          const partPaths = Array.from({ length: chunkCount }, (_, index) => `${destination}.zelux-part${index}`);
          await mergeRangeParts(partPaths, destination, cancelCtrl);
          const finalSize = fs.statSync(destination).size;
          if (finalSize !== entry.size) {
            throw new Error(`ขนาดไฟล์ไม่ตรง: ${entry.path} (${finalSize}/${entry.size})`);
          }
          completedFiles++;
        }
      } catch (err) {
        activePartials.delete(taskIndex);
        if (!firstError) firstError = err;
        abortAllDownloads();
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: connectionCount }, worker));
    if (cancelCtrl.cancelled) throw new Error('CANCELLED');
    if (firstError) throw firstError;

    clearInterval(redrawTimer);
    cancelCtrl.stopListening();
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    bar.update(totalSize || 1, {
      speed: '✓ Done!',
      downloaded: formatBytes(totalSize),
      total: formatBytes(totalSize),
      eta: '0:00',
      files: `${files.length}/${files.length}`,
    });
    bar.stop();
    print();
    print('      ' + success.bold('✓ GitHub repository ดาวน์โหลดเสร็จ!'));
    print('      ' + dim('ขนาด      : ') + chalk.yellow(formatBytes(totalSize)));
    print('      ' + dim('เวลา       : ') + chalk.yellow(formatETA(elapsedSeconds)));
    print('      ' + dim('เฉลี่ย      : ') + chalk.hex('#818cf8')(formatSpeed(totalSize / Math.max(elapsedSeconds, 0.001))));
    print('      ' + dim('ไฟล์       : ') + chalk.yellow(files.length));
    print('      ' + dim('บันทึกที่   : ') + chalk.cyan(targetDir));
    print();
    return { success: true, filePath: targetDir, repository: `${repository.owner}/${repository.repo}` };
  } catch (err) {
    clearInterval(redrawTimer);
    cancelCtrl.stopListening();
    bar.stop();
    abortAllDownloads();
    let cleanupError = null;
    try {
      await removeTreeWithRetries(targetDir, DOWNLOADS_DIR);
    } catch (removeError) {
      cleanupError = removeError;
    }
    if (err.message === 'CANCELLED') {
      if (cleanupError) {
        print('      ' + error.bold('✕ ยกเลิกแล้ว แต่ลบไฟล์ค้างไม่สำเร็จ'));
        print('      ' + dim(cleanupError.message));
      } else {
        print('      ' + warning.bold('⚠️ ยกเลิกและลบไฟล์ที่โหลดค้างแล้ว'));
      }
      print();
      return { success: false, cancelled: true, cleanupFailed: Boolean(cleanupError), error: cleanupError?.message || 'Cancelled' };
    }
    if (cleanupError) throw cleanupError;
    throw err;
  }
}

async function downloadGitHubRepository(url, repository) {
  print('      ' + info('GitHub') + ` ${chalk.cyan(`${repository.owner}/${repository.repo}`)}`);
  print('      ' + dim('กำลังอ่านรายการไฟล์และขนาดรวม...'));
  try {
    const branch = repository.ref || 'HEAD';
    const tree = await fetchJSON(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const plan = summarizeGitHubTree(tree);
    const pinnedRef = /^[a-f0-9]{40}$/i.test(tree.sha || '') ? tree.sha : branch;
    return await downloadGitHubRepositoryMulti(repository, pinnedRef, plan.files, plan.totalSize);
  } catch (err) {
    if (cancelCtrl.cancelled || err.message === 'CANCELLED') {
      return { success: false, cancelled: true, error: 'Cancelled' };
    }
    print('      ' + warning('⚠') + ` Multi-file ใช้ไม่ได้ (${err.message})`);
    print('      ' + dim('สลับกลับเป็น GitHub ZIP อัตโนมัติ...'));
    return downloadGitHubRepositoryArchive(url, repository);
  }
}

async function performDownload(url) {
  let provider;
  try {
    provider = await resolveDownloadProvider(url);
    url = provider.url;
  } catch (err) {
    print('      ' + error('\u2715') + ' ไม่สามารถเปิดลิงก์ผู้ให้บริการได้: ' + err.message);
    print();
    return { success: false, error: err.message };
  }

  if (provider.provider !== 'Direct HTTP') {
    print('      ' + info('☁') + ` Provider: ${chalk.cyan.bold(provider.provider)}`);
  }
  const githubRepository = parseGitHubRepositoryUrl(url);
  if (githubRepository) return downloadGitHubRepository(url, githubRepository);
  const isM3u8 = url.toLowerCase().includes('.m3u8') || url.includes('zelux_m3u8=true');
  if (shouldUseMediaExtractor(url) || isM3u8) {
    return downloadMediaFile(url);
  }
  print('      ' + info('\u27F3') + ' กำลังตรวจสอบลิงก์...');

  let fileInfo;
  try {
    fileInfo = await probeFileInfo(url);
  } catch (err) {
    print('      ' + error('\u2715') + ' ไม่สามารถเชื่อมต่อได้: ' + err.message);
    print();
    return { success: false, error: err.message };
  }

  const { finalUrl, acceptRanges, totalSize, contentType } = fileInfo;
  if (shouldUseMediaExtractor(finalUrl, contentType)) {
    print('      ' + info('\u27F3') + ' ลิงก์นี้เป็นหน้าเว็บ ไม่ใช่ไฟล์ตรง กำลังลองตัวดึงคลิปจากเว็บที่รองรับ...');
    return downloadMediaFile(finalUrl);
  }
  const filename = safeFilename(fileInfo.filename);

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
  const partialPath = `${filePath}.part`;
  let useMulti = acceptRanges && totalSize > 1024 * 1024;
  let connCount = useMulti ? NUM_CONNECTIONS : 1;

  print('      ' + success('\u2713') + ' เชื่อมต่อสำเร็จ!');
  print();
  const displayFilename = filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
  print('      ' + white('\uD83D\uDCC4 ไฟล์: ') + chalk.cyan(displayFilename));
  print('      ' + white('\uD83D\uDCE6 ขนาด: ') + (totalSize > 0 ? chalk.yellow(formatBytes(totalSize)) : dim('ไม่ทราบ')));
  print('      ' + white('\uD83D\uDCDD ชนิด: ') + dim(contentType));
  print('      ' + white('📁 หมวดหมู่: ') + chalk.yellow.bold(category));
  const connectionMode = useMulti
    ? chalk.green.bold(`${connCount}x Multi-connection`)
    : acceptRanges
      ? dim('1x Single connection')
      : chalk.yellow(`1x active / ${NUM_CONNECTIONS}x requested (server does not support Range)`);
  print('      ' + white('\uD83D\uDD17 Mode: ') + connectionMode);
  print();

  let isFirstFrame = true;

  const barSize = 33;
  const bar = createProgressBar(filename, {
    format: (options, params, payload) => {
      const indeterminate = Boolean(payload.indeterminate);
      const pulsePosition = Number(payload.pulsePosition || 0) % barSize;
      const filled = indeterminate ? pulsePosition : Math.round(params.progress * barSize);
      const empty = barSize - filled;
      const rb = indeterminate
        ? rainbowBar(filled, empty)
        : rainbowBar(filled, empty);
      const pct = indeterminate ? ' LIVE ' : (params.progress * 100).toFixed(1) + '%';
      const spd = chalk.hex('#f472b6').bold((payload.speed || '0 B/s').padEnd(12));
      const sizeStr = chalk.hex('#94a3b8')(`${payload.downloaded || '0 B'}/${payload.total || '??'}`);
      const etaStr = indeterminate
        ? chalk.hex('#34d399').bold(`\u23F1 ${payload.elapsed_formatted || '0:00'} elapsed`)
        : chalk.hex('#34d399').bold(`\u23F3 ${payload.eta_formatted || '--:--'} ETA`);

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
  print('      ' + dim('(กด Esc เพื่อยกเลิก)'));

  bar.start(totalSize > 0 ? totalSize : 100, 0, {
    connections: connCount,
    speed: '0 B/s',
    downloaded: '0 B',
    total: totalSize > 0 ? formatBytes(totalSize) : '??',
    eta_formatted: '--:--',
    elapsed_formatted: '0:00',
    indeterminate: totalSize <= 0,
    pulsePosition: 0,
  });

  let downloadedBytes = 0;
  if (useMulti) {
    for (let i = 0; i < connCount; i++) {
      const partPath = `${filePath}.part${i}`;
      if (fs.existsSync(partPath)) downloadedBytes += fs.statSync(partPath).size;
    }
  } else if (acceptRanges && fs.existsSync(partialPath)) {
    downloadedBytes = Math.min(fs.statSync(partialPath).size, totalSize);
  }
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
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const eta = currentSpeed > 0 && totalSize > 0 ? (totalSize - downloadedBytes) / currentSpeed : 0;
    const progressValue = totalSize > 0
      ? Math.min(downloadedBytes, totalSize)
      : Math.floor(elapsedSeconds * 12) % 100;
    bar.update(progressValue, {
      speed: formatSpeed(currentSpeed),
      downloaded: formatBytes(downloadedBytes),
      eta_formatted: formatETA(eta),
      elapsed_formatted: formatETA(elapsedSeconds),
      indeterminate: totalSize <= 0,
      pulsePosition: Math.floor(elapsedSeconds * 12),
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
        downloadedBytes = 0;
        lastBytes = 0;
        currentSpeed = 0;
        isFirstFrame = true;

        terminalWrite('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
        print('      ' + warning('\u26A0') + dim(` Multi-connection ล้มเหลว (${multiErr.message}) — สลับเป็น Single ใน 2 วินาที...`));
        await sleep(2000);

        cleanPartials(filePath, connCount);
        bar.update(downloadedBytes, { connections: 1 });

        await downloadRange(finalUrl, 0, totalSize - 1, partialPath, onData, 0, true);
        fs.renameSync(partialPath, filePath);
      }
    } else {
      if (acceptRanges && totalSize > 0) {
        await downloadRange(finalUrl, 0, totalSize - 1, partialPath, onData, 0, true);
        fs.renameSync(partialPath, filePath);
      } else {
        await downloadRange(finalUrl, undefined, undefined, filePath, onData, 0, true);
      }
    }

    if (cancelCtrl.cancelled) throw new Error('CANCELLED');

    terminalWrite('      ' + dim('\uD83D\uDD12 กำลังคำนวณ SHA256...'));
    const integrity = await verifyDownloadIntegrity(filePath, {
      expectedSize: totalSize > 0 ? totalSize : null,
      expectedSha256: fileInfo.expectedSha256,
    });
    terminalWrite('\r\x1b[K');
    downloadedBytes = integrity.size;
    cancelCtrl.stopListening();
    clearInterval(redrawTimer);
    bar.update(totalSize > 0 ? totalSize : downloadedBytes, {
      speed: '\u2713 Done!',
      eta_formatted: '0:00',
      elapsed_formatted: formatETA((Date.now() - startTime) / 1000),
      downloaded: formatBytes(downloadedBytes),
      total: totalSize > 0 ? formatBytes(totalSize) : formatBytes(downloadedBytes),
      indeterminate: false,
    });
    bar.stop();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgSpd = downloadedBytes / ((Date.now() - startTime) / 1000);

    print();
    print('    ' + rainbowLine('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501', Date.now() / 5));
    print('      ' + success.bold('\u2713 ดาวน์โหลดเสร็จสิ้น!'));
    print('      ' + dim('ขนาด      : ') + chalk.yellow(formatBytes(downloadedBytes)));
    print('      ' + dim('เวลา      : ') + chalk.yellow(elapsed + ' วินาที'));
    print('      ' + dim('เฉลี่ย     : ') + chalk.hex('#818cf8')(formatSpeed(avgSpd)));
    const displayFilePath = filePath.length > 30 ? '...' + filePath.substring(filePath.length - 27) : filePath;
    print('      ' + dim('บันทึก    : ') + chalk.cyan(displayFilePath));
    const displayHash = integrity.sha256.substring(0, 12) + '...' + integrity.sha256.substring(integrity.sha256.length - 12);
    print('      ' + dim('SHA256    : ') + accent(displayHash));
    if (fileInfo.expectedSha256) print('      ' + dim('Checksum  : ') + success('ตรงกับ SHA-256 ที่เซิร์ฟเวอร์แจ้ง'));
    print('    ' + rainbowLine('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501', Date.now() / 5));
    print();
    return { success: true, filePath };

  } catch (err) {
    cancelCtrl.stopListening();
    clearInterval(redrawTimer);
    bar.stop();
    abortAllDownloads();

    if (err.message === 'CANCELLED') {
      let cleanupError = null;
      try { await cleanupDownloadArtifacts(filePath, connCount); } catch (removeError) { cleanupError = removeError; }
      terminalWrite('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      print('      ' + warning.bold('⚠️ ยกเลิกการดาวน์โหลดแล้ว'));
      if (cleanupError) {
        print('      ' + error('ลบไฟล์ชั่วคราวไม่สำเร็จ: ') + cleanupError.message);
      } else {
        print('      ' + dim('ลบไฟล์ชั่วคราวและข้อมูลที่โหลดไม่เสร็จแล้ว'));
      }
      print();
      return { success: false, cancelled: true, cleanupFailed: Boolean(cleanupError), error: cleanupError?.message || 'Cancelled' };
    } else {
      try { await cleanupDownloadArtifacts(filePath, connCount); } catch (cleanupError) {
        print('      ' + warning('⚠ ลบไฟล์ชั่วคราวไม่สำเร็จ: ') + cleanupError.message);
      }
      terminalWrite('\r\x1b[K\x1b[1A\r\x1b[K\x1b[1A\r\x1b[K');
      print('      ' + error('\u2715') + ' ดาวน์โหลดล้มเหลว: ' + err.message);
      print();
      return { success: false, error: err.message };
    }
  }
}

async function downloadSingleFile(url) {
  if (terminalUI?.operation?.cancelled) return { success: false, cancelled: true };
  const historyId = addHistory(url);
  let result;
  try {
    result = await performDownload(url);
    if (!result) result = { success: false, error: 'Download did not complete' };
  } catch (err) {
    result = { success: false, cancelled: err.message === 'CANCELLED', error: err.message };
  }
  finishHistory(historyId, result);
  return result;
}

async function runWithConcurrency(items, limit, handler) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await handler(items[index], index);
    }
  };
  const count = Math.max(1, Math.min(toBoundedInteger(limit, 1, 1, 32), items.length || 1));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

// ═══════════════════════════════════════════
//  BATCH
// ═══════════════════════════════════════════

async function handleBatch(urls) {
  urls = extractUrlsFromText(urls);
  if (urls.length === 0) return [];
  if (urls.length === 1) return [await downloadSingleFile(urls[0])];
  print();
  print('  ' + info('\uD83D\uDCE6') + ` Batch Download — ${chalk.yellow(urls.length)} ไฟล์`);
  const concurrency = Math.min(BATCH_CONCURRENCY, urls.length);
  const results = await runWithConcurrency(urls, concurrency, async (url, index) => {
    print('  ' + info('>') + ` [${index + 1}/${urls.length}] ${dim(url.slice(0, 65))}`);
    return downloadSingleFile(url);
  });
  print('  ' + rainbowLine(' \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550', Date.now() / 5));
  const succeeded = results.filter(result => result?.success).length;
  const failed = results.filter(result => !result?.success && !result?.cancelled).length;
  const cancelled = results.filter(result => result?.cancelled).length;
  const summary = [`สำเร็จ ${succeeded}`];
  if (failed) summary.push(`ล้มเหลว ${failed}`);
  if (cancelled) summary.push(`ยกเลิก ${cancelled}`);
  print('  ' + success.bold(`\u2713 Batch เสร็จสิ้น — ${summary.join(' | ')}`));
  print('  ' + rainbowLine(' \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550', Date.now() / 5));
  print();
  return results;
}

// ═══════════════════════════════════════════
//  FILE MANAGEMENT
// ═══════════════════════════════════════════

function openFolder(spawnProcess = require('child_process').spawn, platform = os.platform(), directory = DOWNLOADS_DIR) {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (err) {
    return Promise.resolve({ success: false, directory, error: err.message });
  }

  const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({ directory, ...result });
    };
    try {
      const child = spawnProcess(command, [directory], {
        detached: true,
        stdio: 'ignore',
        // Explorer is a GUI application. Hiding its window makes this action
        // look like a no-op even when the shell process starts successfully.
        windowsHide: platform !== 'win32',
      });
      child.once('spawn', () => finish({ success: true }));
      child.once('error', err => finish({ success: false, error: err.message }));
      child.unref();
    } catch (err) {
      finish({ success: false, error: err.message });
    }
  });
}

function isValidUrl(s) {
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol); }
  catch { return false; }
}

function resizeTerminal(cols = 80, rows = 25) {
  terminalWrite(`\x1b[8;${rows};${cols}t`);
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
let lastOpenFolderResult = null;

// Write the colored ZELUX-DL prompt manually (not through readline)
function writePrompt() {
  if (currentView !== 'default') {
    terminalWrite('    ' + chalk.hex('#818cf8')('[Enter กลับหน้าหลัก]') + chalk.hex('#a855f7')(' \u276F '));
  } else {
    terminalWrite(brand('    ZELUX') + chalk.hex('#fbbf24')('-DL') + chalk.hex('#a855f7')(' \u276F '));
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
    print();
    print('    ' + rainbowLine('👋 ขอบคุณที่ใช้ ZELUX-DL!', Date.now() / 5));
    print();
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
    terminalWrite('\x1b[1A\x1b[2K');
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

    case 'settings': case 'config':
      currentView = 'settings';
      renderScreen();
      createReadline();
      break;

    case 'history':
      currentView = 'history';
      renderScreen();
      createReadline();
      break;

    case 'set': {
      const parts = input.match(/^set\s+(\S+)\s+(.+)$/i);
      try {
        if (!parts) throw new Error('Usage: set KEY VALUE');
        const value = updateSetting(parts[1], parts[2]);
        print('    ' + success('✓') + ` ${parts[1].toUpperCase()} = ${value}`);
      } catch (err) {
        print('    ' + error('✕') + ' ' + err.message);
      }
      writePrompt();
      break;
    }

    case 'retry': {
      const selector = input.split(/\s+/)[1] || 'failed';
      const entries = readHistory();
      const selected = selector.toLowerCase() === 'failed'
        ? entries.filter(item => item.status === 'failed' || item.status === 'cancelled')
        : entries.filter(item => item.id === selector);
      const urls = [...new Set(selected.map(item => item.url).filter(isValidUrl))];
      if (!urls.length) {
        print('    ' + warning('!') + ' No retryable downloads found');
        writePrompt();
        break;
      }
      if (rl) { rl.removeAllListeners('close'); rl.close(); rl = null; }
      currentView = 'download';
      renderScreen();
      const results = await handleBatch(urls);
      const wasCancelled = results.some(result => result?.cancelled);
      const cleanupFailed = results.some(result => result?.cleanupFailed);
      currentView = wasCancelled && !cleanupFailed ? 'default' : 'download-done';
      if (wasCancelled && !cleanupFailed) renderScreen();
      createReadline();
      break;
    }

    case 'open': case 'o': {
      lastOpenFolderResult = await openFolder();
      currentView = 'open';
      renderScreen();
      createReadline();
      break;
    }

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

    case 'check-update': case 'checkupdate':
      if (rl) { rl.removeAllListeners('close'); rl.close(); rl = null; }
      currentView = 'upgrade';
      renderScreen();
      printUpdateStatus(await checkForUpdate());
      currentView = 'download-done';
      createReadline();
      break;

    case 'exit': case 'quit': case 'q':
      print(); print('    ' + rainbowLine('\uD83D\uDC4B ขอบคุณที่ใช้ ZELUX-DL!', Date.now() / 5)); print();
      process.exit(0);

    default:
      let urls = [];

      // Accept one URL, or many URLs separated by spaces/newlines.
      urls = extractUrlsFromText(input);
      if (urls.length === 0 && input.endsWith('.txt')) {
        // Check if it's a .txt batch file
        const txtPath = path.isAbsolute(input) ? input : path.join(BASE_DIR, input);
        if (fs.existsSync(txtPath)) {
          const content = fs.readFileSync(txtPath, 'utf8');
          urls = extractUrlsFromText(content);
          if (urls.length > 0) {
            print('    ' + info('📦') + ' ดึงลิงก์จากไฟล์สำเร็จ ' + chalk.yellow(urls.length) + ' ลิงก์');
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
        const results = await handleBatch(urls);
        const wasCancelled = results.some(result => result?.cancelled);
        const cleanupFailed = results.some(result => result?.cleanupFailed);
        currentView = wasCancelled && !cleanupFailed ? 'default' : 'download-done';

        // Cancellation returns directly to the main screen; successful jobs keep the result view.
        if (wasCancelled && !cleanupFailed) renderScreen();
        createReadline();
      } else {
        print();
        print('    ' + error('\u2715') + ' ไม่รู้จักคำสั่ง / URL ไม่ถูกต้อง');
        print('    ' + dim('    พิมพ์ ') + chalk.hex('#fbbf24').bold('help') + dim(' ดูคำสั่งทั้งหมด'));
        print();
        writePrompt();
      }
  }
}

async function runUpdate() {
  print('      ' + info('⚡') + ' กำลังตรวจสอบและอัปเดต yt-dlp และ ffmpeg...');

  const ytdlpPath = path.join(BASE_DIR, process.platform === 'win32' ? 'yt-dlp-current.exe' : 'yt-dlp-current');
  const ffmpegPath = path.join(BASE_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

  try {
    if (fs.existsSync(ytdlpPath)) fs.unlinkSync(ytdlpPath);
    if (fs.existsSync(ffmpegPath)) fs.unlinkSync(ffmpegPath);
  } catch (e) {
    print('      ' + warning('⚠️') + ' ไม่สามารถลบไฟล์เก่าได้ (อาจจะกำลังถูกใช้งานอยู่)');
  }

  await getYtDlpPath();
  await getFfmpegPath();

  print();
  print('      ' + success.bold('✓ อัปเดตเสร็จสิ้น!'));
}

async function runTerminalApp(initialUrls = [], initialCookieFile = '') {
  terminalUI = new TerminalUI({
    version: APP_VERSION,
    motion: !process.argv.includes('--no-animation') && process.env.ZELUX_REDUCED_MOTION !== '1',
    snapshot: () => {
      const entries = readHistory();
      return {
        directory: DOWNLOADS_DIR, connections: NUM_CONNECTIONS,
        completed: entries.filter(entry => entry.status === 'completed').length,
        failed: entries.filter(entry => entry.status === 'failed').length,
      };
    },
    onCancel: () => cancelCtrl.cancel(),
  });
  const ui = terminalUI;
  const run = async (title, action, cancellable = true) => {
    cancelCtrl.cancelled = false;
    try {
      const result = await ui.run(title, action, cancellable);
      const lines = [...ui.logs];
      if (Array.isArray(result)) {
        const completed = result.filter(item => item?.success).length;
        const cancelled = result.filter(item => item?.cancelled).length;
        const failed = result.length - completed - cancelled;
        lines.unshift(`${completed} completed  /  ${failed} failed  /  ${cancelled} cancelled`, '');
        for (const item of result) {
          if (item?.error) lines.push(item.error);
          if (item?.filePath) lines.push(`Saved: ${item.filePath}`);
        }
      }
      await ui.page('RESULT / ' + title, lines.length ? lines : ['Finished.']);
    } catch (err) {
      await ui.page(err.message === 'CANCELLED' ? 'CANCELLED' : 'ERROR', [err.message, ...ui.logs.slice(-8)]);
    }
  };
  ui.start();
  try {
    const startupUpdatePromise = checkForUpdateQuickly();
    let startupInput = null;
    if (ui.introPromise) {
      await ui.introPromise;
    }
    const startupUpdate = await startupUpdatePromise;
    if (ui.state.type === 'input') startupInput = ui.state.text;
    if (startupUpdate?.available) {
      if (!initialUrls.length) {
        try {
          const shouldUpgrade = await ui.choose([
            { label: 'NOT NOW, CONTINUE', value: false },
            { label: `UPDATE TO ${startupUpdate.latest} NOW`, value: true },
          ], 'UPDATE AVAILABLE');
          if (shouldUpgrade) await run('UPDATE', selfUpdate, false);
        } catch (err) {
          if (err.message !== 'CANCELLED') throw err;
        }
      }
    }
    if (initialUrls.length) {
      const action = () => handleBatch(initialUrls);
      await run('DOWNLOAD', () => initialCookieFile
        ? withTemporaryFacebookCookies(initialCookieFile, action)
        : action());
    }
    while (true) {
      let input = startupInput === null ? await ui.home() : await ui.ask('ADD DOWNLOADS', undefined, startupInput);
      startupInput = null;
      if (input === 'download') input = await ui.ask('ADD DOWNLOADS');
      if (!input) continue;
      const cmd = input.split(/\s+/)[0].toLowerCase();
      if (['q', 'exit', 'quit'].includes(cmd)) break;
      if (['clear', 'cls'].includes(cmd)) continue;
      if (['open', 'o'].includes(cmd)) {
        const result = await openFolder();
        await ui.page(result.success ? 'DOWNLOAD FOLDER OPENED' : 'COULD NOT OPEN DOWNLOAD FOLDER', [
          result.success ? 'A File Explorer window has been opened.' : (result.error || 'Unknown error'),
          result.directory,
        ]);
        continue;
      }
      if (['help', 'h', '?'].includes(cmd)) {
        await ui.page('COMMANDS', [
          'Paste URLs separated by spaces or newlines. Enter submits.',
          'A .txt file path imports a batch of links.', '',
          { label: 'history', description: 'Review recent jobs and their IDs', color: 'cyan' },
          { label: 'library', description: 'Browse files, sources and SHA-256 duplicates', color: 'purple' },
          { label: 'retry failed', description: 'Retry failed / cancelled jobs', color: 'yellow' },
          { label: 'retry ID', description: 'Retry one job from history', color: 'yellow' },
          { label: 'settings', description: 'Edit settings with arrow keys', color: 'blue' },
          { label: 'set KEY VALUE', description: 'Change a setting directly', color: 'blue' },
          { label: 'open', description: 'Open the download folder', color: 'green' },
          { label: 'list', description: 'List files in the download folder', color: 'green' },
          { label: 'check-update', description: 'Check ZELUX-DL release version', color: 'cyan' },
          { label: 'upgrade', description: 'Update the packaged executable', color: 'purple' },
          { label: 'update', description: 'Reinstall yt-dlp / ffmpeg', color: 'magenta' },
          { label: 'exit', description: 'Exit the application', color: 'red' }, '',
          'Esc during a download cancels it and cleans partial files.',
          'Launch with --plain for the original command interface.',
          'Launch with --no-animation to skip the startup reveal and color motion.',
        ]);
      } else if (cmd === 'history') {
        const entries = readHistory().slice().reverse();
        await ui.page('DOWNLOAD HISTORY', entries.length ? entries.flatMap(entry => [
          `${entry.status.toUpperCase()}   ${entry.id}`,
          entry.url, entry.filePath || entry.error || '', '',
        ]) : ['No downloads yet. Select DOWNLOAD to add a link.']);
      } else if (cmd === 'library') {
        await run('SMART LIBRARY', async () => {
          const library = await buildSmartLibrary(DOWNLOADS_DIR, readHistory());
          print(`Folder: ${library.directory}`);
          print(`${library.files.length} files  ·  ${formatBytes(library.totalBytes)} total  ·  ${library.duplicates.length} duplicate groups`);
          print('');
          print('FILE TYPES');
          for (const [category, count] of Object.entries(library.categories)) {
            if (count) print(`  ${category.padEnd(14)} ${count}`);
          }
          print('');
          if (library.duplicates.length) {
            print('DUPLICATES  ·  matched by SHA-256');
            for (const group of library.duplicates) {
              print(`  ${formatBytes(group[0].size)}  ${group[0].sha256.slice(0, 12)}…`);
              for (const file of group) print(`    ${file.relativePath}`);
            }
            print('');
          } else print('No duplicate files found.');
          print('RECENT FILES  ·  newest first');
          for (const file of library.files.slice(0, 12)) {
            let sourceHost = 'source unknown';
            if (file.source) {
              try { sourceHost = new URL(file.source).hostname; } catch (_) { sourceHost = 'source saved'; }
            }
            print(`  ${formatBytes(file.size).padEnd(9)} ${file.category.padEnd(12)} ${file.relativePath}`);
            print(`             ${sourceHost}`);
          }
          if (!library.files.length) print('No files yet. Downloads will appear here when complete.');
        }, false);
      } else if (['list', 'ls', 'l'].includes(cmd)) {
        const entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
        await ui.page('DOWNLOAD FILES', [DOWNLOADS_DIR, '', ...entries.map(entry =>
          entry.isDirectory() ? `[folder] ${entry.name}` : `${formatBytes(fs.statSync(path.join(DOWNLOADS_DIR, entry.name)).size)}  ${entry.name}`
        ), '', 'Use open to browse files inside category folders.']);
      } else if (['settings', 'config'].includes(cmd)) {
        const values = { ...getConfigSnapshot(), DOWNLOADS_DIR };
        try {
          const name = await ui.choose(Object.entries(values).map(([key, value]) => ({ value: key, label: `${key}: ${value}` })), 'SETTINGS');
          const value = await ui.ask(name, 'Enter saves this setting. Esc leaves it unchanged.', String(values[name]));
          if (value !== null) {
            const saved = updateSetting(name, value);
            await ui.page('SETTING SAVED', [`${name} = ${saved}`]);
          }
        } catch (err) {
          if (err.message !== 'CANCELLED') await ui.page('SETTING NOT SAVED', [err.message]);
        }
      } else if (cmd === 'set') {
        try {
          const parts = input.match(/^set\s+(\S+)\s+(.+)$/i);
          if (!parts) throw new Error('Usage: set KEY VALUE');
          const saved = updateSetting(parts[1], parts[2]);
          await ui.page('SETTING SAVED', [`${parts[1].toUpperCase()} = ${saved}`]);
        } catch (err) { await ui.page('SETTING NOT SAVED', [err.message]); }
      } else if (['check-update', 'checkupdate'].includes(cmd)) {
        await run('CHECK FOR UPDATES', async () => printUpdateStatus(await checkForUpdate()), false);
      } else if (cmd === 'upgrade' || ['update', 'u'].includes(cmd)) {
        try {
          const confirmed = await ui.choose([
            { label: 'BACK', value: false },
            { label: cmd === 'upgrade' ? 'CHECK AND INSTALL ZELUX-DL UPDATE' : 'REINSTALL MEDIA TOOLS', value: true },
          ], 'CONFIRM UPDATE');
          if (confirmed) await run('UPDATE', cmd === 'upgrade' ? selfUpdate : runUpdate, false);
        } catch (err) { if (err.message !== 'CANCELLED') throw err; }
      } else {
        let urls = extractUrlsFromText(input);
        if (cmd === 'retry') {
          const selector = input.split(/\s+/)[1] || 'failed';
          urls = [...new Set(readHistory().filter(entry => selector === 'failed'
            ? ['failed', 'cancelled'].includes(entry.status) : entry.id === selector).map(entry => entry.url).filter(isValidUrl))];
        } else if (!urls.length) {
          const batchPath = input.replace(/^"(.*)"$/, '$1');
          if (/\.txt$/i.test(batchPath)) {
            try { urls = extractUrlsFromText(fs.readFileSync(path.resolve(BASE_DIR, batchPath), 'utf8')); }
            catch (err) { await ui.page('CANNOT READ BATCH FILE', [err.message]); continue; }
          }
        }
        if (!urls.length) await ui.page('NO DOWNLOADS', [cmd === 'retry' ? 'No retryable downloads found.' : 'No valid URL or command found.', 'Select DOWNLOAD to paste links, or COMMANDS for help.']);
        else await run(`DOWNLOAD / ${urls.length} LINK${urls.length > 1 ? 'S' : ''}`, () => handleBatch(urls));
      }
    }
  } finally { ui.close(); terminalUI = null; }
}

async function main() {
  cleanupStaleTemporaryFacebookCookies();
  if (process.argv.includes('--version')) { console.log(APP_VERSION); return; }
  if (process.argv.includes('--check-ui')) {
    const probe = new TerminalUI({ version: APP_VERSION, snapshot: () => ({ completed: 0, failed: 0, connections: 0, directory: 'renderer-check' }) });
    for (const size of [[60, 26], [90, 32]]) {
      const frame = probe.buildFrame(...size);
      if (!frame.lines.length) throw new Error('Terminal renderer produced an empty frame');
    }
    console.log('Terminal renderer OK');
    return;
  }
  const rawArgs = process.argv.slice(2);
  const protocolArg = rawArgs.find(value => /^zelux:/i.test(String(value || '').trim()));
  const protocolRequest = protocolArg ? decodeZeluxProtocolRequest(protocolArg) : null;
  if (protocolRequest?.exePath && await handoffToConfiguredZeluxExe(protocolRequest.exePath, protocolArg)) return;
  const initialUrls = protocolRequest?.urls?.length ? protocolRequest.urls : extractUrlsFromText(rawArgs);
  let initialCookieFile = '';
  try {
    if (protocolRequest?.cookieToken) {
      if (!initialUrls.length || initialUrls.some(url => getMediaProviderName(url) !== 'Facebook')) {
        throw new Error('Temporary Facebook cookies can only be used with Facebook links.');
      }
      console.log('Waiting for the ZELUX-DL extension to send a temporary Facebook session…');
      const cookies = await receiveTemporaryFacebookCookies(protocolRequest.cookieToken);
      initialCookieFile = writeTemporaryFacebookCookiesFromNetscape(cookies);
    }

    if (process.stdin.isTTY && process.stdout.isTTY && (process.platform === 'win32' || process.env.TERM !== 'dumb') && !process.argv.includes('--plain')) {
      if (process.stdout.columns < 60 || process.stdout.rows < 26) resizeTerminal(90, 32);
      await runTerminalApp(initialUrls, initialCookieFile);
      return;
    }
  if (process.stdout.isTTY) {
  resizeTerminal(47, 22);
  await animatedIntro();
  }
  currentView = 'default';
  renderScreen();

  // Non-blocking update notification. Network failures are intentionally quiet.
  const startupUpdate = await checkForUpdateQuickly();
  if (startupUpdate?.available) {
    printUpdateStatus(startupUpdate);
    print();
  }

  let args = rawArgs;
  try {
    const redactedArgs = args.map(value => /^zelux:/i.test(String(value || '').trim())
      ? 'zelux://download?<redacted>'
      : value);
    fs.writeFileSync(require('path').join(BASE_DIR, 'args.log'), JSON.stringify({ argv: [process.argv[0], ...redactedArgs], cwd: process.cwd(), args: redactedArgs }));
  } catch (e) { }

  args = initialUrls;
  if (args.length > 0) {
    currentView = 'download';
    renderScreen();
    const action = () => handleBatch(args);
    if (initialCookieFile) await withTemporaryFacebookCookies(initialCookieFile, action);
    else await action();
    currentView = 'download-done';
  }

  createReadline();
  } finally {
    if (initialCookieFile) removeTemporaryFacebookCookies(initialCookieFile);
  }
}

if (require.main === module) {
  main().catch(err => {
    terminalUI?.close();
    console.error(err.stack || String(err));
    try {
      fs.writeFileSync(path.join(BASE_DIR, 'error.log'), err.stack || String(err), 'utf8');
    } catch (_) { /* Preserve the console error if the app folder is read-only. */ }
    process.exitCode = 1;
  });
}

module.exports = {
  CancelController,
  buildMediaCookieArgs,
  buildGitHubArchiveUrl,
  buildSmartLibrary,
  buildGitHubRawUrl,
  buildWindowsUpdateScript,
  compareVersions,
  cleanupStaleTemporaryFacebookCookies,
  decodeZeluxProtocolRequest,
  decodeZeluxProtocolArg,
  decodeZeluxProtocolArgs,
  handoffToConfiguredZeluxExe,
  diagnoseHttpResponse,
  downloadRange,
  findChecksum,
  getMediaProviderName,
  formatGitHubProgressLines,
  extractUrlsFromText,
  formatFacebookCookies,
  receiveTemporaryFacebookCookies,
  removeTemporaryFacebookCookies,
  writeTemporaryFacebookCookies,
  isValidUrl,
  isAllowedCookieRelayOrigin,
  normalizeZeluxExePath,
  isMediaExtractorUrl,
  openFolder,
  isCancelInput,
  mergeRangeParts,
  parseGitHubRepositoryUrl,
  parseYtDlpProgressLine,
  parseSha256Metadata,
  planGitHubRangeTasks,
  resolveDownloadProvider,
  probeFileInfo,
  removeDirectoryIfEmpty,
  cleanupDownloadArtifacts,
  removeTreeWithRetries,
  resolveZipEntryPath,
  runWithConcurrency,
  safeFilename,
  shouldUseMediaExtractor,
  summarizeGitHubTree,
  toBoundedInteger,
  verifyDownloadIntegrity,
  verifyZeluxExeIdentity,
  waitForUpdateHelperReady,
};
