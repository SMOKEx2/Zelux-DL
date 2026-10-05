const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const photos = require('../zelux-extension/photo-selection');
const { downloadTikTokPhotoPost, downloadFacebookPhotoPost, decodeZeluxProtocolRequest } = require('../zelux');
const url = 'https://www.tiktok.com/@test/photo/123456';
const post = { id: '123456', title: 'Selected photo test', sourceUrl: url, images: Array.from({ length: 19 }, (_, i) => ({ urls: [`https://p16-common-sign.tiktokcdn.com/${i + 1}.jpeg`] })) };
const clean = result => { if (result?.filePath) fs.rmSync(path.dirname(result.filePath), { recursive: true, force: true }); };

test('photo selection remembers 1, 10, 19 across nine-photo pages and all applies to the entire post', () => {
  const m = photos.create(19);
  assert.equal(m.pages, 3);
  m.clear(); m.toggle(1); m.turn(1); m.toggle(10);
  assert.deepEqual(m.visible(), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  m.turn(1); assert.deepEqual(m.visible(), [19]); m.toggle(19); m.turn(1);
  assert.equal(m.page, 2); m.turn(-2); assert.equal(m.selected.has(1), true);
  assert.deepEqual(m.payload(), { total: 19, positions: [1, 10, 19] });
  m.all(); assert.equal(m.selected.size, 19); m.clear(); assert.throws(() => m.payload());
});

test('photo selection rejects empty, duplicate, unordered, out-of-range and mismatched selections', () => {
  for (const value of [{ total: 19, positions: [] }, { total: 19, positions: [1, 1] }, { total: 19, positions: [10, 1] }, { total: 19, positions: [0] }, { total: 19, positions: [20] }, { total: 201, positions: [1] }, { total: 19, positions: ['1'] }]) assert.throws(() => photos.validate(value, value.positions.length));
  assert.throws(() => photos.validate({ total: 19, positions: [1] }, 2));
});

test('terminal selection downloads only chosen TikTok photos with original numbers', async () => {
  let result; const called = [];
  try {
    result = await downloadTikTokPhotoPost(url, () => { throw new Error('Must not fetch'); }, async (src, dest) => { called.push(src); fs.writeFileSync(dest, 'image'); }, post, null, async (count, provider) => { assert.equal(count, 19); assert.equal(provider, 'TikTok'); return [1, 10, 19]; });
    assert.equal(result.success, true); assert.equal(result.postImages, 19); assert.equal(result.totalImages, 3);
    assert.deepEqual(result.filePaths.map(p => path.basename(p)), ['001.jpeg', '010.jpeg', '019.jpeg']);
    assert.equal(called.length, 3); assert.ok(called[1].endsWith('/10.jpeg'));
  } finally { clean(result); }
});

test('extension selection skips another prompt and downloads only the transported subset', async () => {
  const positions = [1, 10, 19];
  const capture = { ...post, images: positions.map(n => post.images[n - 1]) };
  const params = new URLSearchParams({ urls: JSON.stringify([url]), tikTokPost: JSON.stringify(capture), photoSelection: JSON.stringify({ total: 19, positions }) });
  const request = decodeZeluxProtocolRequest(`zelux://download?${params}`);
  assert.deepEqual(request.photoSelection, { total: 19, positions });
  let result;
  try {
    result = await downloadTikTokPhotoPost(url, () => { throw new Error('Must not fetch'); }, async (_, dest) => fs.writeFileSync(dest, 'image'), request.tikTokPost, request.photoSelection, () => { throw new Error('Must not prompt again'); });
    assert.deepEqual(result.filePaths.map(p => path.basename(p)), ['001.jpeg', '010.jpeg', '019.jpeg']);
  } finally { clean(result); }
  for (const bad of [{ total: 19, positions: [] }, { total: 19, positions: [1] }, { total: 19, positions: [1, 1, 19] }]) {
    params.set('photoSelection', JSON.stringify(bad));
    const invalid = decodeZeluxProtocolRequest(`zelux://download?${params}`);
    assert.deepEqual(invalid.urls, []); assert.ok(invalid.error);
  }
  params.set('photoSelection', '{bad');
  assert.ok(decodeZeluxProtocolRequest(`zelux://download?${params}`).error);
});

test('cancelled or empty photo confirmation never writes files or starts network downloads', async () => {
  let downloads = 0;
  const downloader = () => { downloads++; };
  await assert.rejects(downloadTikTokPhotoPost(url, undefined, downloader, post, null, () => { throw new Error('CANCELLED'); }), /CANCELLED/);
  await assert.rejects(downloadTikTokPhotoPost(url, undefined, downloader, post, null, () => []));
  await assert.rejects(downloadTikTokPhotoPost(url, () => { downloads++; }, downloader, null, { total: 19, positions: [1] }));
  assert.equal(downloads, 0);
});

test('Facebook uses the same chosen subset and original photo numbers', async () => {
  const images = Array.from({ length: 19 }, (_, i) => `https://scontent.test.fbcdn.net/photo${i + 1}.jpg`);
  let result;
  try {
    result = await downloadFacebookPhotoPost('https://www.facebook.com/test/posts/123', () => { throw new Error('Must not fetch'); }, async (_, dest) => fs.writeFileSync(dest, 'image'), images, null, () => [10, 19]);
    assert.deepEqual(result.filePaths.map(p => path.basename(p)), ['010.jpg', '019.jpg']);
    assert.equal(result.postImages, 19);
  } finally { clean(result); }
});
