// Mock Prism app: implements the IPC endpoints the native host talks to
// (`GET /v1/health`, `POST /v1/message`), records every message and writes
// ipc.json into a data dir. Usable standalone:
//   node e2e/mock-app.mjs <dataDir>
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOCK_SETTINGS = {
  captureEnabled: true,
  minSize: 0,
  excludedSites: ['never-capture.test'],
  bypassKey: 'alt',
  showVideoButton: true,
};

export const MOCK_FORMATS = [
  { id: '137+140', label: '1080p · MP4 · 145 MB', kind: 'video', ext: 'mp4', height: 1080, size: 152043520 },
  { id: '22', label: '720p · MP4 · 61 MB', kind: 'muxed', ext: 'mp4', height: 720 },
  { id: '140', label: 'Audio · M4A · 4 MB', kind: 'audio', ext: 'm4a', size: 4194304 },
];

/** The qualities every sniffed manifest declares (`probeStream`), in manifest order. */
export const MOCK_VARIANTS = [
  { index: 0, url: 'v360.m3u8', bandwidth: 800000, width: 640, height: 360 },
  { index: 1, url: 'v1080.m3u8', bandwidth: 5000000, width: 1920, height: 1080 },
  { index: 2, url: 'v720.m3u8', bandwidth: 2000000, width: 1280, height: 720 },
];

function reply(msg) {
  switch (msg.type) {
    case 'hello':
      return { ok: true, app: { name: 'Prism', version: '0.0.0-mock' }, protocol: 1, settings: MOCK_SETTINGS };
    case 'status':
      return { ok: true, app: { name: 'Prism', version: '0.0.0-mock' }, captureEnabled: true };
    case 'download':
      return { ok: true, accepted: true, downloadId: randomBytes(4).toString('hex') };
    case 'batch':
      return { ok: true, accepted: true, count: msg.items?.length ?? 0 };
    case 'video':
      return { ok: true, accepted: true };
    case 'probeVideo':
      return { ok: true, title: 'Mock video', formats: MOCK_FORMATS };
    case 'probeStream':
      return { ok: true, variants: MOCK_VARIANTS.map((v) => ({ ...v, url: new URL(v.url, msg.url).href })) };
    case 'open':
    case 'openVideoUrl':
      return { ok: true };
    default:
      return { ok: false, error: { code: 'unknown_type', message: `unknown message type ${msg.type}` } };
  }
}

export async function startMockApp(dataDir) {
  const token = randomBytes(32).toString('hex');
  const messages = [];
  const waiters = [];
  const server = createServer((req, res) => {
    const send = (status, body) => {
      const b = Buffer.from(JSON.stringify(body));
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length });
      res.end(b);
    };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { ok: false, error: { code: 'unauthorized', message: 'bad token' } });
    if (req.method === 'GET' && req.url === '/v1/health') return send(200, { ok: true, version: '0.0.0-mock' });
    if (req.method !== 'POST' || req.url !== '/v1/message') return send(404, { ok: false, error: { code: 'not_found', message: req.url } });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const receivedAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { ok: false, error: { code: 'bad_json', message: 'invalid JSON' } });
      }
      const entry = { receivedAt, msg };
      messages.push(entry);
      for (const w of waiters.slice()) {
        if (w.pred(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(entry);
        }
      }
      // A post that takes a while to read (the "Best quality" item shows while waiting).
      const slow = msg.type === 'probeVideo' && String(msg.pageUrl).endsWith('/status/333');
      // A manifest server that hangs: the video menu must not wait for it.
      const hung = msg.type === 'probeStream' && String(msg.url).includes('/slow/');
      setTimeout(() => send(200, reply(msg)), hung ? 10000 : slow ? 2000 : 0);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  mkdirSync(dataDir, { recursive: true });
  const ipcFile = join(dataDir, 'ipc.json');
  writeFileSync(ipcFile, JSON.stringify({ port, token, pid: process.pid, version: '0.0.0-mock' }));
  return {
    port,
    token,
    messages,
    /** Resolves with the first (already received or future) message matching `pred`. */
    waitFor(pred, timeoutMs = 5000, { since = 0 } = {}) {
      const hit = messages.find((m) => m.receivedAt >= since && pred(m.msg));
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred: (m) => pred(m), resolve, timer: null };
        w.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`mock app: no matching message within ${timeoutMs} ms`));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    async close({ removeIpc = true } = {}) {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      if (removeIpc) rmSync(ipcFile, { force: true });
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? join(process.env.APPDATA ?? process.env.HOME ?? '.', 'Prism');
  const app = await startMockApp(dir);
  console.log(`mock Prism app on 127.0.0.1:${app.port}, ipc.json in ${dir}`);
  setInterval(() => {
    while (app.messages.length) console.log(JSON.stringify(app.messages.shift().msg));
  }, 200);
}
