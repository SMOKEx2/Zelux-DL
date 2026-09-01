const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const {
  CancelController,
  buildGitHubArchiveUrl,
  buildGitHubRawUrl,
  compareVersions,
  decodeZeluxProtocolArg,
  decodeZeluxProtocolArgs,
  downloadRange,
  extractUrlsFromText,
  findChecksum,
  formatGitHubProgressLines,
  isValidUrl,
  isCancelInput,
  mergeRangeParts,
  parseGitHubRepositoryUrl,
  parseYtDlpProgressLine,
  planGitHubRangeTasks,
  removeDirectoryIfEmpty,
  removeTreeWithRetries,
  resolveDownloadProvider,
  resolveZipEntryPath,
  runWithConcurrency,
  safeFilename,
  summarizeGitHubTree,
  toBoundedInteger,
} = require('../zelux');

test('decodeZeluxProtocolArg preserves encoded GitHub URLs and legacy links', () => {
  const githubUrl = 'https://github.com/owner/project/releases/download/v1.0/app.zip?download=1#asset';
  const protocolUrl = `zelux://download?url=${encodeURIComponent(githubUrl)}`;
  assert.equal(decodeZeluxProtocolArg(protocolUrl), githubUrl);
  assert.equal(decodeZeluxProtocolArg('zelux://https://github.com/owner/project'), 'https://github.com/owner/project');
  assert.equal(decodeZeluxProtocolArg(githubUrl), githubUrl);
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

test('extension 2.2 sends multiple fully encoded URLs through the protocol', async () => {
  const listeners = {};
  let execution = null;
  const chrome = {
    runtime: {
      onInstalled: { addListener: listener => { listeners.installed = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } },
    },
    contextMenus: {
      create: () => {},
      onClicked: { addListener: listener => { listeners.clicked = listener; } },
    },
    scripting: {
      executeScript: async options => { execution = options; },
    },
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'background.js'), 'utf8');
  vm.runInNewContext(source, { chrome, console, encodeURIComponent, setTimeout });
  const urls = [
    'https://github.com/owner/project/releases/download/v1.0/app.zip?raw=1#asset',
    'https://example.com/second.zip?download=1',
  ];
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

  assert.equal(response.ok, true);
  assert.equal(response.count, 2);
  assert.equal(execution.target.tabId, 42);
  assert.equal(execution.args[0], `zelux://download?urls=${encodeURIComponent(JSON.stringify(urls))}`);
  const popupSource = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'popup.js'), 'utf8');
  assert.match(popupSource, /tab\?\.url && \/\^https\?:/);
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
