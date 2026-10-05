// Explicit live smoke test, not part of the offline test suite.
// Start a playwright-cli session named tiktok-photos on the target post first.
// Usage: node scripts/smoke-tiktok-photos.js <path-to-playwright-cli.js> [built-exe]
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const { decodeZeluxProtocolRequest, downloadTikTokPhotoPost } = require('../zelux');

async function main() {
  const cli = process.argv[2];
  if (!cli || !fs.existsSync(cli)) throw new Error('Supply the installed playwright-cli.js path');
  const source = fs.readFileSync(path.join(__dirname, '../zelux-extension/tiktok-photos.js'), 'utf8');
  const expression = `() => { ${source}; return globalThis.ZeluxTikTokPhotos.captureDocument(document, location.href); }`;
  const command = spawnSync(process.execPath, [cli, '-s=tiktok-photos', 'eval', expression], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (command.status !== 0) throw new Error(command.stderr || command.stdout);
  const match = command.stdout.match(/### Result\r?\n([\s\S]*?)\r?\n### Ran/);
  if (!match) throw new Error('No browser capture returned');
  let post = JSON.parse(match[1]);
  assert.ok(post?.images.length, 'No carousel captured');
  const selectedPositions = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
  const selection = selectedPositions ? { total: post.images.length, positions: selectedPositions } : null;
  if (selection) post = { ...post, images: selectedPositions.map(n => post.images[n - 1]) };
  const query = new URLSearchParams({ urls: JSON.stringify([post.sourceUrl]), tikTokPost: JSON.stringify(post) });
  if (selection) query.set('photoSelection', JSON.stringify(selection));
  const protocol = `zelux://download?${query}`;
  assert.ok(protocol.length < 30000, 'Capture exceeds the protocol transport limit');
  const decoded = decodeZeluxProtocolRequest(protocol);
  assert.equal(decoded.tikTokPost.images.length, post.images.length);
  const result = await downloadTikTokPhotoPost(decoded.urls[0], undefined, undefined, decoded.tikTokPost, decoded.photoSelection);
  assert.equal(result.success, true, result.error);
  assert.equal(result.downloadedImages, post.images.length);
  if (selection) assert.deepEqual(result.filePaths.map(file => Number(path.basename(file).split('.')[0])), selection.positions);
  for (const file of result.filePaths) {
    const data = fs.readFileSync(file);
    assert.ok(data.length > 1000, `Empty image: ${file}`);
    assert.ok(data[0] === 0xff && data[1] === 0xd8 || data.subarray(0, 4).toString() === 'RIFF' || data[0] === 0x89, `Invalid image: ${file}`);
  }
  const outputDir = path.join(__dirname, '../output/playwright');
  fs.mkdirSync(outputDir, { recursive: true });
  const report = { id: post.id, expected: post.images.length, selection, downloaded: result.downloadedImages, protocolLength: protocol.length, directory: path.dirname(result.filePath), fileSizes: result.filePaths.map(file => ({ name: path.basename(file), bytes: fs.statSync(file).size })) };
  const appPath = process.argv[3];
  const executable = appPath || process.execPath;
  const appArgs = appPath ? [protocol, '--plain'] : [path.join(__dirname, '../zelux.js'), protocol, '--plain'];
  const app = spawnSync(executable, appArgs, { input: 'exit\n', encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(outputDir, 'tiktok-app-smoke.log'), app.stdout || app.stderr || '');
  assert.equal(app.status, 0, app.error?.message || app.stderr);
  assert.ok(app.stdout.includes(`รูปที่ ${selection?.positions.at(-1) || post.images.length}/${selection?.total || post.images.length} เสร็จแล้ว`), 'Real app did not finish the selected carousel');
  assert.ok(!app.stdout.includes('MP3 (') && !app.stdout.includes('MP4 ('), 'Photo download showed a media-format prompt');
  report.appEntryPoint = appPath || 'node zelux.js';
  report.appExitCode = app.status;
  fs.writeFileSync(path.join(outputDir, 'tiktok-photo-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
