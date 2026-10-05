const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const photos = require('../zelux-extension/tiktok-photos');
const { inspectTikTokPost, downloadTikTokPhotoPost, chooseBatchMediaOptions, decodeZeluxProtocolRequest } = require('../zelux');

const url = 'https://www.tiktok.com/@author/photo/123456';
const image = name => `https://p16-common-sign.tiktokcdn.com/photos/${name}.jpeg?signature=x`;
const item = (id = '123456') => ({ id, desc: 'Test carousel', imagePost: { images: ['a', 'b'].map(name => ({ imageURL: { urlList: [image(name)] } })) } });
const html = post => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: post } } } })}</script>`;
const capture = () => ({ ...photos.parsePost(html(item()), url), sourceUrl: url });
const cleanup = result => { if (result?.filePath) fs.rmSync(path.dirname(result.filePath), { recursive: true, force: true }); };

test('TikTok parser reads only the requested carousel, not avatar/music or other posts', () => {
  const p = item();
  p.author = { avatarLarger: image('avatar') };
  p.music = { coverLarge: image('music') };
  assert.deepEqual(photos.parsePost(html(p), url).images.map(i => i.urls[0]), [image('a'), image('b')]);
  assert.equal(photos.parsePost(html(item('999')), url), null);
  assert.equal(photos.parsePost('<script id="SIGI_STATE">{"ItemModule":' + JSON.stringify({ '999': item('999'), '123456': item() }) + '}</script>', url).images.length, 2);
});

test('TikTok captures reject malformed lists, untrusted URLs, credentials and mismatched IDs', () => {
  assert.ok(photos.normalizeCapture(capture(), [url]));
  for (const images of [null, {}, [null], [{ urls: {} }], [{ urls: ['http://127.0.0.1/a.jpg'] }], [{ urls: ['https://tiktokcdn.com.evil.example/a.jpg'] }]]) {
    assert.equal(photos.normalizeCapture({ ...capture(), images }, [url]), null);
  }
  assert.equal(photos.normalizeCapture(capture(), ['https://www.tiktok.com/@author/photo/999']), null);
  assert.equal(photos.normalizeCapture(capture(), [url, url]), null);
  assert.equal(photos.normalizeCapture({ ...capture(), sourceUrl: 'https://www.tiktok.com/@x/photo/999' }, [url]), null);
  assert.equal(photos.isTikTokUrl('https://user:password@www.tiktok.com/@x/photo/1'), false);
  assert.equal(photos.isTikTokPhotoUrl(url + '?q=test'), true);
  assert.equal(photos.isTikTokPhotoUrl(url.replace('/photo/', '/video/')), false);
});

test('TikTok parser does not silently accept an incomplete image list', () => {
  const p = item();
  p.imagePost.images.push({ imageURL: { urlList: ['https://example.com/not-a-photo'] } });
  assert.equal(photos.parsePost(html(p), url), null);
  assert.equal(photos.parsePost('<script id="SIGI_STATE">not json</script>', url), null);
});

test('TikTok browser SPA capture binds the carousel to the post and keeps slide order', () => {
  const slide = (index, name) => ({ getAttribute: () => String(index), querySelector: () => ({ src: image(name) }) });
  const article = { __reactFiber$test: { memoizedProps: {}, return: { memoizedProps: { id: '123456' } } }, querySelectorAll: () => [slide(1, 'b'), slide(0, 'a')], querySelector: () => ({ textContent: 'Two photos' }) };
  const doc = { documentElement: { outerHTML: '' }, querySelectorAll: () => [article] };
  assert.deepEqual(photos.captureDocument(doc, url).images.map(i => i.urls[0]), [image('a'), image('b')]);
  article.__reactFiber$test.return.memoizedProps.id = '999';
  assert.equal(photos.captureDocument(doc, url), null);
  article.__reactFiber$test.return.memoizedProps.id = '123456';
  article.querySelectorAll = () => [slide(0, 'a'), slide(2, 'b')];
  assert.equal(photos.captureDocument(doc, url), null);
});

test('TikTok page inspection follows short links and tries the equivalent video route', async () => {
  const calls = [];
  const post = await inspectTikTokPost('https://vm.tiktok.com/test/', async (requested, headers, options) => {
    calls.push(requested);
    assert.equal(options.maxBodyBytes, 16 * 1024 * 1024);
    return { finalUrl: url, statusCode: 200, body: calls.length === 1 ? 'SPA page' : html(item()) };
  });
  assert.equal(post.images.length, 2);
  assert.deepEqual(calls, ['https://vm.tiktok.com/test/', url.replace('/photo/', '/video/')]);
  assert.equal(post.sourceUrl, url);
});

test('TikTok blocked pages explain the extension fallback and videos remain videos', async () => {
  await assert.rejects(inspectTikTokPost(url, async () => ({ body: 'Login', statusCode: 403 })), /Send to ZELUX-DL/);
  await assert.rejects(inspectTikTokPost(url, async () => ({ finalUrl: 'https://example.com', body: '' })), /ไม่รองรับ/);
  const video = await inspectTikTokPost(url.replace('/photo/', '/video/'), async () => 'video page');
  assert.deepEqual(video.images, []);
});

test('TikTok photo batches skip the audio/video selection while mixed batches ask once', async () => {
  assert.equal(await chooseBatchMediaOptions([url, url.replace('123456', '789')], () => { throw new Error('No format prompt for photos'); }), null);
  let prompts = 0;
  const selection = await chooseBatchMediaOptions([url, 'https://youtu.be/test'], async () => { prompts++; return 'mp3'; });
  assert.equal(prompts, 1);
  assert.equal(selection.formatType, 'mp3');
});

test('TikTok extension protocol payload reaches the app with validation and no cookie token', () => {
  const source = fs.readFileSync(path.join(__dirname, '../zelux-extension/background.js'), 'utf8');
  const context = { URL, URLSearchParams, chrome: { runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} } }, contextMenus: { onClicked: { addListener() {} } } } };
  // Read just the pure protocol builder, avoiding background service-worker setup.
  const builder = source.slice(source.indexOf('function buildProtocolUrl('), source.indexOf('\nfunction isFacebookHost'));
  vm.runInNewContext(builder, context);
  context.normalizeFacebookImageUrls = () => [];
  const protocol = context.buildProtocolUrl([url], '', 'D:\\Zelux-DL\\ZELUX-DL.exe', [], capture());
  const decoded = decodeZeluxProtocolRequest(protocol);
  assert.equal(decoded.tikTokPost.images.length, 2);
  assert.equal(decoded.cookieToken, '');
  assert.equal(decoded.exePath, 'D:\\Zelux-DL\\ZELUX-DL.exe');
  const bad = new URL(protocol);
  bad.searchParams.set('tikTokPost', JSON.stringify({ ...capture(), id: '999' }));
  assert.equal(decodeZeluxProtocolRequest(bad.href).tikTokPost, undefined);
});

test('TikTok captured photos download in order without refetching the page or selecting MP3', async () => {
  let result;
  try {
    result = await downloadTikTokPhotoPost(url, () => { throw new Error('Must use capture'); }, async (src, destination, referer) => {
      assert.equal(referer, url);
      fs.writeFileSync(destination, src);
    }, capture());
    assert.equal(result.success, true);
    assert.equal(result.downloadedImages, 2);
    assert.deepEqual(result.filePaths.map(p => path.basename(p)), ['001.jpeg', '002.jpeg']);
    assert.equal(fs.readFileSync(result.filePaths[1], 'utf8'), image('b'));
  } finally { cleanup(result); }
});

test('TikTok downloader retries alternate image URLs and does not report partial success as complete', async () => {
  const p = capture();
  p.images[0].urls.push(image('fallback'));
  let result;
  try {
    result = await downloadTikTokPhotoPost(url, undefined, async (src, dest) => {
      fs.writeFileSync(dest, 'partial');
      if (src !== image('fallback')) throw new Error('HTTP 403');
    }, p);
    assert.equal(result.success, false);
    assert.equal(result.downloadedImages, 1);
    assert.equal(result.failedImages, 1);
    assert.deepEqual(fs.readdirSync(path.dirname(result.filePath)), ['001.jpeg']);
    assert.match(result.error, /1\/2/);
  } finally { cleanup(result); }
});

test('TikTok cancellation waits for workers and removes incomplete image files', async () => {
  let directory;
  let settled = 0;
  await assert.rejects(downloadTikTokPhotoPost(url, undefined, async (src, dest) => {
    directory = path.dirname(dest);
    fs.writeFileSync(dest, 'partial');
    await new Promise(resolve => setTimeout(resolve, 10));
    settled++;
    throw new Error('CANCELLED');
  }, capture()), /CANCELLED/);
  assert.equal(settled, 2);
  assert.equal(fs.existsSync(directory), false);
});
