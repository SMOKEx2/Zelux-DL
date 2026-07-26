const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  compareVersions,
  downloadRange,
  findChecksum,
  isValidUrl,
  runWithConcurrency,
  safeFilename,
  toBoundedInteger,
} = require('../zelux');

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
