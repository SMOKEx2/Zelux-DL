const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const {
  CancelController,
  buildSmartLibrary,
  cleanupDownloadArtifacts,
  buildGitHubArchiveUrl,
  buildGitHubRawUrl,
  buildWindowsUpdateScript,
  compareVersions,
  decodeZeluxProtocolArg,
  decodeZeluxProtocolArgs,
  diagnoseHttpResponse,
  downloadRange,
  extractUrlsFromText,
  findChecksum,
  formatGitHubProgressLines,
  isValidUrl,
  openFolder,
  isCancelInput,
  mergeRangeParts,
  parseGitHubRepositoryUrl,
  parseYtDlpProgressLine,
  parseSha256Metadata,
  planGitHubRangeTasks,
  removeDirectoryIfEmpty,
  removeTreeWithRetries,
  resolveDownloadProvider,
  probeFileInfo,
  resolveZipEntryPath,
  runWithConcurrency,
  safeFilename,
  summarizeGitHubTree,
  toBoundedInteger,
  verifyDownloadIntegrity,
} = require('../zelux');

test('smart library classifies files, links download sources and hashes duplicate content', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-library-'));
  try {
    const nested = path.join(root, 'archives');
    fs.mkdirSync(nested);
    const video = path.join(root, 'clip.MP4');
    const archiveA = path.join(root, 'bundle-a.zip');
    const archiveB = path.join(nested, 'bundle-b.zip');
    fs.writeFileSync(video, 'video-data');
    fs.writeFileSync(archiveA, 'same archive');
    fs.writeFileSync(archiveB, 'same archive');
    fs.writeFileSync(path.join(root, 'unfinished.zip.part'), 'partial');

    const library = await buildSmartLibrary(root, [
      { status: 'completed', filePath: video, url: 'https://example.com/watch/123' },
      { status: 'failed', filePath: archiveA, url: 'https://bad.example/file' },
    ]);

    assert.equal(library.files.length, 3);
    assert.equal(library.totalBytes, Buffer.byteLength('video-data') + 2 * Buffer.byteLength('same archive'));
    assert.equal(library.files.find(file => file.path === video).category, 'Video');
    assert.equal(library.files.find(file => file.path === video).source, 'https://example.com/watch/123');
    assert.equal(library.duplicates.length, 1);
    assert.deepEqual(library.duplicates[0].map(file => file.name).sort(), ['bundle-a.zip', 'bundle-b.zip']);
    assert.equal(library.categories.Archive, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('decodeZeluxProtocolArg preserves encoded GitHub URLs and legacy links', () => {
  const githubUrl = 'https://github.com/owner/project/releases/download/v1.0/app.zip?download=1#asset';
  const protocolUrl = `zelux://download?url=${encodeURIComponent(githubUrl)}`;
  assert.equal(decodeZeluxProtocolArg(protocolUrl), githubUrl);
  assert.equal(decodeZeluxProtocolArg('zelux://https://github.com/owner/project'), 'https://github.com/owner/project');
  assert.equal(decodeZeluxProtocolArg(githubUrl), githubUrl);
});

test('MediaFire resolver accepts the structured HTTP page response', async () => {
  const resolved = await resolveDownloadProvider('https://www.mediafire.com/file/id/sample.zip/file', async () => ({
    body: '<a id="downloadButton" href="https://download1.mediafire.com/sample.zip">Download</a>',
    headers: {},
  }));
  assert.equal(resolved.url, 'https://download1.mediafire.com/sample.zip');
});

test('decodeZeluxProtocolArgs accepts a multi-link protocol payload', () => {
  const urls = [
    'https://example.com/one.zip?download=1',
    'https://github.com/owner/project/releases/download/v2/app.exe',
  ];
  const protocolUrl = `zelux://download?urls=${encodeURIComponent(JSON.stringify(urls))}`;
  assert.deepEqual(decodeZeluxProtocolArgs(protocolUrl), urls);
});

test('extractUrlsFromText finds valid links and removes duplicates', () => {
  assert.deepEqual(extractUrlsFromText(`
    download https://example.com/one.zip
    https://example.com/two.iso
    https://example.com/one.zip
    javascript:alert(1)
  `), [
    'https://example.com/one.zip',
    'https://example.com/two.iso',
  ]);
});

test('resolveDownloadProvider converts public cloud share links', async () => {
  assert.deepEqual(
    await resolveDownloadProvider('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'),
    {
      provider: 'Google Drive',
      url: 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t',
    },
  );

  const dropbox = await resolveDownloadProvider('https://www.dropbox.com/scl/fi/token/file.zip?rlkey=abc&dl=0');
  assert.equal(dropbox.provider, 'Dropbox');
  assert.equal(new URL(dropbox.url).searchParams.get('dl'), '1');

  assert.deepEqual(
    await resolveDownloadProvider('https://pixeldrain.com/u/AbC_123'),
    { provider: 'Pixeldrain', url: 'https://pixeldrain.com/api/file/AbC_123?download' },
  );

  assert.deepEqual(
    await resolveDownloadProvider('https://huggingface.co/openai/model/blob/main/model.bin'),
    { provider: 'Hugging Face', url: 'https://huggingface.co/openai/model/resolve/main/model.bin?download=true' },
  );

  assert.deepEqual(
    await resolveDownloadProvider('https://www.tiktok.com/@creator/video/123'),
    { provider: 'TikTok', url: 'https://www.tiktok.com/@creator/video/123' },
  );

  const fileHosts = [
    ['https://1filez.com/file/abc', '1Filez'],
    ['https://vik1ngfile.site/f/abc', 'VikingFile'],
    ['https://www.rootz.so/file/abc', 'Rootz'],
    ['https://buzzheavier.com/d/abc', 'BuzzHeavier'],
    ['https://datanodes.to/files/abc', 'DataNodes'],
    ['https://filemirage.com/file/abc', 'FileMirage'],
  ];
  for (const [url, provider] of fileHosts) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const fetchPage = async pageUrl => ({
      body: '<a class="download-button" href="/files/archive.zip">Download</a>',
      headers: {},
      finalUrl: pageUrl,
    });
    const resolved = await resolveDownloadProvider(url, fetchPage);
    assert.equal(resolved.provider, provider);
    assert.equal(new URL(resolved.url).hostname, host === 'vik1ngfile.site' ? 'vikingfile.com' : new URL(url).hostname);
    assert.equal(new URL(resolved.url).pathname, '/files/archive.zip');
  }

  const fileKeeper = 'https://filekeeper.net/abc123/file.pdf';
  assert.deepEqual(await resolveDownloadProvider(fileKeeper), { provider: 'FileKeeper', url: fileKeeper });
  const fileDitch = 'https://fileditchfiles.st/alpha/id/archive.rar';
  assert.deepEqual(await resolveDownloadProvider(fileDitch), { provider: 'FileDitchFiles', url: fileDitch });
});

test('resolveDownloadProvider follows BuzzHeavier HTMX download redirects', async () => {
  const calls = [];
  const resolved = await resolveDownloadProvider('https://buzzheavier.com/d/abc', async (url, headers = {}) => {
    calls.push({ url, headers });
    if (calls.length === 1) {
      return { body: '<button hx-get="/api/download/abc">Download</button>', headers: {}, finalUrl: url };
    }
    return { body: '', headers: { 'hx-redirect': 'https://cdn.buzzheavier.com/file/archive.zip' }, finalUrl: url };
  });
  assert.deepEqual(resolved, { provider: 'BuzzHeavier', url: 'https://cdn.buzzheavier.com/file/archive.zip' });
  assert.equal(calls[1].headers['HX-Request'], 'true');
});

test('resolveDownloadProvider reports host pages that require browser verification', async () => {
  await assert.rejects(
    resolveDownloadProvider('https://datanodes.to/files/abc', async url => ({
      body: '<html>Checking your browser. Complete the CAPTCHA to continue.</html>', headers: {}, finalUrl: url,
    })),
    /ต้องยืนยันผ่านเว็บ/,
  );
});

test('HTTP diagnostics distinguish authentication, CAPTCHA, missing files and rate limits', () => {
  assert.match(diagnoseHttpResponse(401, {}, ''), /ต้องล็อกอิน/);
  assert.match(diagnoseHttpResponse(403, {}, '<html>Cloudflare Turnstile CAPTCHA</html>', 'Host'), /CAPTCHA/);
  assert.match(diagnoseHttpResponse(404, {}, ''), /ลิงก์อาจถูกลบหรือหมดอายุ/);
  assert.match(diagnoseHttpResponse(410, {}, ''), /ลิงก์อาจถูกลบหรือหมดอายุ/);
  assert.match(diagnoseHttpResponse(429, {}, ''), /จำกัดคำขอชั่วคราว/);
  assert.equal(diagnoseHttpResponse(200, {}, ''), null);
});

test('parseSha256Metadata accepts common checksum headers and rejects malformed values', () => {
  const digest = crypto.createHash('sha256').update('checksum fixture').digest();
  const hex = digest.toString('hex');
  const base64 = digest.toString('base64');
  assert.equal(parseSha256Metadata({ 'X-Checksum-Sha256': hex }), hex);
  assert.equal(parseSha256Metadata({ Digest: `sha-256=:${base64}:` }), hex);
  assert.equal(parseSha256Metadata({ 'x-goog-hash': `crc32c=AAAA,sha256=${base64}` }), hex);
  assert.equal(parseSha256Metadata({ 'x-amz-checksum-sha256': 'not-a-checksum' }), null);
});

test('verifyDownloadIntegrity checks actual size and compares a provided SHA-256', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-integrity-'));
  const filePath = path.join(tempDir, 'fixture.bin');
  const payload = Buffer.from('trusted fixture bytes');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  fs.writeFileSync(filePath, payload);
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  assert.deepEqual(await verifyDownloadIntegrity(filePath, { expectedSize: payload.length, expectedSha256: hash }), {
    size: payload.length, sha256: hash,
  });
  await assert.rejects(verifyDownloadIntegrity(filePath, { expectedSize: payload.length + 1 }), /ขนาดไฟล์ไม่ตรง/);
  await assert.rejects(verifyDownloadIntegrity(filePath, { expectedSha256: '0'.repeat(64) }), /SHA-256.*ไม่ตรง/);
});

test('probeFileInfo reads reliable file metadata and explains provider error pages', async t => {
  const payload = Buffer.from('probe fixture payload');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const server = http.createServer((request, response) => {
    if (request.url === '/missing') {
      response.writeHead(404, { 'Content-Type': 'text/html' });
      response.end('<h1>Not found</h1>');
      return;
    }
    if (request.url === '/challenge') {
      response.writeHead(403, { 'Content-Type': 'text/html' });
      response.end('<html>Complete CAPTCHA to continue</html>');
      return;
    }
    const range = request.headers.range;
    response.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="fixture.bin"',
      'Content-Length': range ? 1 : payload.length,
      ...(range ? { 'Content-Range': `bytes 0-0/${payload.length}` } : {}),
      'X-Checksum-Sha256': hash,
    });
    response.end(range ? payload.subarray(0, 1) : payload);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const info = await probeFileInfo(`${base}/file`);
  assert.equal(info.totalSize, payload.length);
  assert.equal(info.expectedSha256, hash);
  assert.equal(info.filename, 'fixture.bin');
  await assert.rejects(probeFileInfo(`${base}/missing`), /ลิงก์อาจถูกลบหรือหมดอายุ/);
  await assert.rejects(probeFileInfo(`${base}/challenge`), /CAPTCHA/);
});

test('resolveDownloadProvider ignores download links inside HTML comments', async () => {
  await assert.rejects(
    resolveDownloadProvider('https://vik1ngfile.site/f/example', async url => ({
      body: '<!-- <a class="button" href="/fast-download/ad-redirect">Download</a> --><a id="download-link" class="hidden">Generating link</a>',
      headers: {}, finalUrl: url,
    })),
    /ไม่พบปุ่มหรือลิงก์ดาวน์โหลด/,
  );
});

test('resolveDownloadProvider extracts MediaFire download button safely', async () => {
  const resolved = await resolveDownloadProvider(
    'https://www.mediafire.com/file/token/archive.zip/file',
    async () => '<html><a class="input" id="downloadButton" href="https://download1.mediafire.com/a&amp;b/archive.zip">Download</a></html>',
  );
  assert.deepEqual(resolved, {
    provider: 'MediaFire',
    url: 'https://download1.mediafire.com/a&b/archive.zip',
  });

  await assert.rejects(
    resolveDownloadProvider('https://www.mediafire.com/file/missing/file', async () => '<html>Not found</html>'),
    /MediaFire/,
  );
});

test('parseYtDlpProgressLine handles playlist items and current yt-dlp progress', () => {
  assert.deepEqual(
    parseYtDlpProgressLine('[download] Downloading item 17 of 200'),
    { type: 'item', current: 17, total: 200 },
  );
  assert.deepEqual(
    parseYtDlpProgressLine('[download]  42.8% of    9.34MiB at   57.18MiB/s ETA 00:00'),
    { type: 'progress', percent: 42.8, size: '9.34MiB', speed: '57.18MiB/s', eta: '00:00' },
  );
  assert.deepEqual(parseYtDlpProgressLine('[ExtractAudio] Destination: song.mp3'), { type: 'completed' });
  assert.equal(parseYtDlpProgressLine('[youtube] Downloading webpage'), null);
});

test('extension scans page links and sends reviewed batches through the protocol', async () => {
  const listeners = {};
  let execution = null;
  const chrome = {
    runtime: {
      onInstalled: { addListener: listener => { listeners.installed = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } },
    },
    contextMenus: {
      create: () => {},
      removeAll: callback => callback(),
      onClicked: { addListener: listener => { listeners.clicked = listener; } },
    },
    scripting: {
      executeScript: async options => {
        execution = options;
        if (options.func && !options.args) {
          const document = {
            querySelectorAll(selector) {
              if (selector === 'a[href]') return [
                { href: 'https://example.com/file.zip', innerText: 'Download file' },
                { href: 'javascript:void(0)', innerText: 'Bad link' },
                { href: 'https://example.com/file.zip', innerText: 'Duplicate' },
              ];
              return [{ src: 'https://example.com/video.mp4', tagName: 'VIDEO', getAttribute: () => '' }];
            },
          };
          const result = vm.runInNewContext(`(${options.func.toString()})()`, {
            URL,
            document,
            location: { href: 'https://example.com/page' },
          });
          return [{ result }];
        }
      },
    },
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'background.js'), 'utf8');
  vm.runInNewContext(source, { chrome, console, encodeURIComponent, setTimeout });
  const urls = [
    'https://github.com/owner/project/releases/download/v1.0/app.zip?raw=1#asset',
    'https://example.com/second.zip?download=1',
  ];
  const scanned = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('extension scan response timed out')), 1000);
    listeners.message({ type: 'scan-page', tabId: 42 }, {}, value => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  assert.equal(scanned.ok, true);
  assert.deepEqual(Array.from(scanned.urls), ['https://example.com/file.zip', 'https://example.com/video.mp4']);
  assert.equal(execution.target.tabId, 42);

  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('extension response timed out')), 1000);
    const keepAlive = listeners.message(
      { type: 'launch-download', urls, tabId: 42 },
      {},
      value => {
        clearTimeout(timer);
        resolve(value);
      },
    );
    assert.equal(keepAlive, true);
  });

  assert.equal(response.ok, true, response.error);
  assert.equal(response.count, 2);
  assert.equal(execution.target.tabId, 42);
  assert.equal(execution.args[0], `zelux://download?urls=${encodeURIComponent(JSON.stringify(urls))}`);
  const popupSource = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'popup.js'), 'utf8');
  assert.match(popupSource, /type: 'scan-page'/);
  assert.match(popupSource, /type: 'launch-download'/);
  assert.match(popupSource, /message\.urls|urls,/);
});

test('parseGitHubRepositoryUrl recognizes repository roots only', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/dharmx/walls'), { owner: 'dharmx', repo: 'walls' });
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/dharmx/walls.git/'), { owner: 'dharmx', repo: 'walls' });
  assert.equal(parseGitHubRepositoryUrl('https://github.com/dharmx/walls/tree/main'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com.evil.test/dharmx/walls'), null);
});

test('parseGitHubRepositoryUrl converts GitHub archive URLs into ranged repository plans', () => {
  assert.deepEqual(
    parseGitHubRepositoryUrl('https://github.com/vyrx-dev/Wallpapers/archive/refs/heads/master.zip'),
    { owner: 'vyrx-dev', repo: 'Wallpapers', ref: 'master' },
  );
  assert.deepEqual(
    parseGitHubRepositoryUrl('https://codeload.github.com/vyrx-dev/Wallpapers/zip/refs/heads/master'),
    { owner: 'vyrx-dev', repo: 'Wallpapers', ref: 'master' },
  );
});

test('buildGitHubArchiveUrl safely preserves branch paths', () => {
  assert.equal(
    buildGitHubArchiveUrl({ owner: 'owner', repo: 'project' }, 'feature/glass ui'),
    'https://codeload.github.com/owner/project/zip/refs/heads/feature/glass%20ui',
  );
});

test('buildGitHubRawUrl encodes refs and repository paths', () => {
  assert.equal(
    buildGitHubRawUrl({ owner: 'owner', repo: 'project' }, 'feature/ui', 'folder/wall paper.png'),
    'https://raw.githubusercontent.com/owner/project/feature%2Fui/folder/wall%20paper.png',
  );
});

test('summarizeGitHubTree returns exact file totals and rejects truncated trees', () => {
  const result = summarizeGitHubTree({
    truncated: false,
    tree: [
      { type: 'tree', path: 'images' },
      { type: 'blob', mode: '100644', path: 'images/a.jpg', size: 120 },
      { type: 'blob', mode: '100644', path: 'images/b.png', size: 80 },
      { type: 'blob', mode: '120000', path: 'link', size: 8 },
    ],
  });
  assert.equal(result.totalSize, 200);
  assert.deepEqual(result.files.map(file => file.path), ['images/a.jpg', 'images/b.png']);
  assert.throws(() => summarizeGitHubTree({ truncated: true, tree: [] }), /truncated/);
});

test('planGitHubRangeTasks splits one large GitHub file across all connections', () => {
  const size = 32 * 1024 * 1024;
  const entry = { path: 'release/app.bin', size };
  const plan = planGitHubRangeTasks([entry], size, 16);

  assert.equal(plan.connectionCount, 16);
  assert.equal(plan.tasks.length, 16);
  assert.equal(plan.tasks[0].start, 0);
  assert.equal(plan.tasks.at(-1).end, size - 1);
  assert.equal(plan.tasks.reduce((sum, task) => sum + task.length, 0), size);
  for (let index = 1; index < plan.tasks.length; index++) {
    assert.equal(plan.tasks[index].start, plan.tasks[index - 1].end + 1);
  }
});

test('mergeRangeParts restores chunk order and removes partial files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-range-merge-'));
  const parts = ['alpha', 'beta', 'gamma'].map((value, index) => {
    const partPath = path.join(root, `file.part${index}`);
    fs.writeFileSync(partPath, value);
    return partPath;
  });
  const destination = path.join(root, 'file.bin');

  await mergeRangeParts(parts, destination, { cancelled: false });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'alphabetagamma');
  assert.ok(parts.every(partPath => !fs.existsSync(partPath)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('isCancelInput accepts Windows Terminal escape sequences and Ctrl+C', () => {
  assert.equal(isCancelInput('\x1b'), true);
  assert.equal(isCancelInput('\x1b[27;1;27~'), true);
  assert.equal(isCancelInput('\x03'), true);
  assert.equal(isCancelInput('q'), false);
  assert.equal(isCancelInput('\x1b[A'), false);
  assert.equal(isCancelInput('\x1b[200~'), false);
});

test('downloadRange settles promptly when its controller is cancelled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-cancel-'));
  const destination = path.join(root, 'slow.bin');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': 1024 * 1024 * 20 });
    const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 20);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const controller = new CancelController();
  controller.startListening();

  const startedAt = Date.now();
  const pending = downloadRange(`http://127.0.0.1:${port}/slow.bin`, undefined, undefined, destination, () => { }, 0, false, controller);
  setTimeout(() => controller.cancel(), 60);
  await assert.rejects(pending, /CANCELLED/);
  assert.ok(Date.now() - startedAt < 1000);

  controller.stopListening();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveZipEntryPath blocks traversal and absolute paths', () => {
  const destination = path.join(os.tmpdir(), 'zelux-extract-root');
  assert.equal(resolveZipEntryPath(destination, 'repo/images/wall.jpg'), path.join(destination, 'repo', 'images', 'wall.jpg'));
  assert.throws(() => resolveZipEntryPath(destination, '../outside.txt'), /ออกนอกโฟลเดอร์/);
  assert.throws(() => resolveZipEntryPath(destination, 'C:\\outside.txt'), /ออกนอกโฟลเดอร์/);
  assert.throws(() => resolveZipEntryPath(destination, '/outside.txt'), /ออกนอกโฟลเดอร์/);
});

test('removeDirectoryIfEmpty removes only empty directories inside the allowed root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-empty-root-'));
  const empty = path.join(root, 'Archives');
  const occupied = path.join(root, 'Images');
  fs.mkdirSync(empty);
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, 'wall.jpg'), 'data');

  assert.equal(removeDirectoryIfEmpty(empty, root), true);
  assert.equal(fs.existsSync(empty), false);
  assert.equal(removeDirectoryIfEmpty(occupied, root), false);
  assert.equal(removeDirectoryIfEmpty(root, root), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('removeTreeWithRetries deletes nested partial directories bottom-up', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-clean-root-'));
  const target = path.join(root, 'walls');
  fs.mkdirSync(path.join(target, 'abstract', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(target, 'aerial'), { recursive: true });
  fs.writeFileSync(path.join(target, 'abstract', 'nested', 'wall.zelux-part'), 'partial');

  assert.equal(await removeTreeWithRetries(target, root, 2), true);
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(removeTreeWithRetries(root, root, 1), /outside download root/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('cleanupDownloadArtifacts removes the incomplete file and every configured chunk', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-cancel-cleanup-'));
  const filePath = path.join(root, 'archive.rar');
  for (const suffix of ['', '.part', '.part0', '.part1', '.part2', '.part3', '.part15']) {
    fs.writeFileSync(`${filePath}${suffix}`, 'partial');
  }
  assert.equal(await cleanupDownloadArtifacts(filePath, 4, root), true);
  for (const suffix of ['', '.part', '.part0', '.part1', '.part2', '.part3', '.part15']) {
    assert.equal(fs.existsSync(`${filePath}${suffix}`), false, `${suffix || 'final partial'} should be removed`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('GitHub progress formatter keeps a long bar above one compact stats line', () => {
  const lines = formatGitHubProgressLines(0.026, {
    speed: '82.9 MB/s', eta: '1:00', downloaded: '82.9 MB', total: '3.2 GB',
  });
  const stripAnsi = value => value.replace(/\x1b\[[0-9;]*m/g, '');
  const barLine = stripAnsi(lines.barLine);
  const statsLine = stripAnsi(lines.statsLine);
  assert.equal(/[\r\n]/.test(barLine + statsLine), false);
  assert.ok(barLine.length <= 47, `bar was ${barLine.length} columns: ${barLine}`);
  assert.ok(statsLine.length <= 47, `stats were ${statsLine.length} columns: ${statsLine}`);
  assert.match(barLine, /2\.6%$/);
  assert.match(statsLine, /82\.9 MB\/s.*82\.9MB\/3\.2GB.*ETA 1:00/);
});

test('compareVersions compares releases with or without a v prefix', () => {
  assert.equal(compareVersions('v1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.0', 'v1.0.0'), 0);
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1);
});

test('isValidUrl accepts only HTTP and HTTPS URLs', () => {
  assert.equal(isValidUrl('https://example.com/video'), true);
  assert.equal(isValidUrl('http://localhost/file'), true);
  assert.equal(isValidUrl('file:///etc/passwd'), false);
  assert.equal(isValidUrl('not a url'), false);
});

test('openFolder launches a visible Windows Explorer window and reports success', async () => {
  const { EventEmitter } = require('node:events');
  const directory = 'C:\\Downloads with spaces';
  const child = new EventEmitter();
  child.unref = () => {};
  let invocation;
  const resultPromise = openFolder((...args) => { invocation = args; return child; }, 'win32', directory);
  child.emit('spawn');
  assert.deepEqual(await resultPromise, { directory, success: true });
  assert.deepEqual(invocation, ['explorer.exe', [directory], {
    detached: true, stdio: 'ignore', windowsHide: false,
  }]);
});

test('openFolder reports when the file browser cannot start', async () => {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  child.unref = () => {};
  const resultPromise = openFolder(() => child, 'win32', 'downloads');
  child.emit('error', new Error('launcher unavailable'));
  assert.deepEqual(await resultPromise, { directory: 'downloads', success: false, error: 'launcher unavailable' });
});

test('safeFilename prevents traversal and invalid Windows names', () => {
  assert.equal(safeFilename('../../movie.mp4'), 'movie.mp4');
  assert.equal(safeFilename('bad:name?.mp4'), 'bad_name_.mp4');
  assert.match(safeFilename('CON'), /^download_\d+$/);
});

test('toBoundedInteger rejects unsafe config values', () => {
  assert.equal(toBoundedInteger(8, 4, 1, 32), 8);
  assert.equal(toBoundedInteger('16', 4, 1, 32), 16);
  assert.equal(toBoundedInteger(1000, 4, 1, 32), 4);
  assert.equal(toBoundedInteger('oops', 4, 1, 32), 4);
});

test('findChecksum selects and validates the requested release asset', () => {
  const hash = 'a'.repeat(64);
  assert.equal(findChecksum(`${hash}  ZELUX-DL.exe\n`, 'ZELUX-DL.exe'), hash);
  assert.equal(findChecksum('invalid  ZELUX-DL.exe\n', 'ZELUX-DL.exe'), null);
});

test('Windows update handoff waits, verifies the replacement, relaunches, and logs rollback errors', () => {
  const script = buildWindowsUpdateScript();
  assert.match(script, /Get-Process -Id \$ParentPid/);
  assert.match(script, /for \(\$Attempt = 1; \$Attempt -le 20/);
  assert.match(script, /\$ActualVersion -ne \$ExpectedVersion/);
  assert.match(script, /Start-Process -FilePath \$ExePath -WorkingDirectory \$WorkDir -PassThru/);
  assert.match(script, /Restored the previous executable and reopening it/);
  assert.match(script, /\[string\]\$LogPath/);
  assert.match(script, /Write-UpdateLog "Update\/relaunch failed:/);
});

test('runWithConcurrency respects its worker limit and preserves order', async () => {
  let active = 0;
  let maximum = 0;
  const values = await runWithConcurrency([1, 2, 3, 4], 2, async value => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8]);
  assert.equal(maximum, 2);
});

test('downloadRange resumes an existing partial file', async t => {
  const payload = Buffer.from('resume-download-content');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-test-'));
  const destination = path.join(tempDir, 'file.part');
  fs.writeFileSync(destination, payload.subarray(0, 7));

  const server = http.createServer((request, response) => {
    const start = Number((request.headers.range || 'bytes=0-').match(/bytes=(\d+)/)[1]);
    response.writeHead(206, {
      'Content-Length': payload.length - start,
      'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
    });
    response.end(payload.subarray(start));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const address = server.address();
  await downloadRange(`http://127.0.0.1:${address.port}/file`, 0, payload.length - 1, destination, () => {});
  assert.deepEqual(fs.readFileSync(destination), payload);
});
