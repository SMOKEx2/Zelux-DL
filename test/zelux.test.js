const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const {
  CancelController,
  buildMediaCookieArgs,
  buildCookieHeaderFromNetscape,
  chooseBatchMediaOptions,
  downloadFacebookPhotoPost,
  buildMediaPostprocessArgs,
  buildSmartLibrary,
  cleanupDownloadArtifacts,
  cleanupMediaInfoJson,
  extractFacebookPostImageUrls,
  isFacebookImageUrl,
  isFacebookPhotoPostUrl,
  buildGitHubArchiveUrl,
  buildGitHubRawUrl,
  buildWindowsUpdateScript,
  buildWindowsUpdateLauncherScript,
  compareVersions,
  cleanupStaleTemporaryFacebookCookies,
  cleanupStaleTemporaryYouTubeCookies,
  decodeZeluxProtocolRequest,
  decodeZeluxProtocolArg,
  decodeZeluxProtocolArgs,
  diagnoseHttpResponse,
  downloadRange,
  extractUrlsFromText,
  formatFacebookCookies,
  formatYouTubeCookies,
  ensureMediaCookiesFile,
  hasNetscapeCookieEntries,
  receiveTemporaryMediaCookies,
  findChecksum,
  getMediaProviderName,
  formatGitHubProgressLines,
  handoffToConfiguredZeluxExe,
  isValidUrl,
  isAllowedCookieRelayOrigin,
  isMediaExtractorUrl,
  isLikelyMediaPlaylist,
  listInfoJsonFiles,
  openFolder,
  isCancelInput,
  mergeRangeParts,
  normalizeZeluxExePath,
  parseGitHubRepositoryUrl,
  parseYtDlpProgressLine,
  parseSha256Metadata,
  planGitHubRangeTasks,
  removeDirectoryIfEmpty,
  removeTreeWithRetries,
  receiveTemporaryFacebookCookies,
  removeTemporaryFacebookCookies,
  removeTemporaryYouTubeCookies,
  resolveDownloadProvider,
  probeFileInfo,
  quoteWindowsArgument,
  postprocessMediaInfoJson,
  parseYtDlpAfterMovePath,
  resolveZipEntryPath,
  runWithConcurrency,
  safeFilename,
  shouldUseMediaExtractor,
  summarizeGitHubTree,
  toBoundedInteger,
  verifyDownloadIntegrity,
  waitForUpdateHelperReady,
  writeTemporaryFacebookCookies,
  writeTemporaryYouTubeCookies,
  withTemporaryMediaCookies,
} = require('../zelux');

test('media extraction covers known providers, short links and generic video pages', () => {
  const knownSites = [
    ['https://youtu.be/abc123', 'YouTube'],
    ['https://vimeo.com/12345', 'Vimeo'],
    ['https://vm.tiktok.com/abc/', 'TikTok'],
    ['https://www.facebook.com/reel/123', 'Facebook'],
    ['https://fb.watch/abc/', 'Facebook'],
    ['https://www.instagram.com/reel/abc/', 'Instagram'],
    ['https://x.com/user/status/123', 'X/Twitter'],
    ['https://www.twitch.tv/videos/123', 'Twitch'],
    ['https://www.dailymotion.com/video/abc', 'Dailymotion'],
    ['https://soundcloud.com/artist/track', 'SoundCloud'],
  ];
  for (const [url, provider] of knownSites) {
    assert.equal(getMediaProviderName(url), provider, url);
    assert.equal(isMediaExtractorUrl(url), true, url);
  }

  assert.equal(getMediaProviderName('https://unlisted-video-site.example/watch/1'), null);
  assert.equal(shouldUseMediaExtractor('https://unlisted-video-site.example/watch/1', 'text/html; charset=utf-8'), true);
  assert.equal(shouldUseMediaExtractor('https://unlisted-video-site.example/archive.zip', 'application/zip'), false);
  assert.equal(shouldUseMediaExtractor('https://cdn.example/stream.m3u8', 'application/vnd.apple.mpegurl'), true);
  assert.equal(shouldUseMediaExtractor('https://example.com/page', 'application/xhtml+xml'), true);
});

test('Facebook photo posts are separated from video links and image URLs are deduplicated', () => {
  assert.equal(isFacebookPhotoPostUrl('https://www.facebook.com/example/posts/123'), true);
  assert.equal(isFacebookPhotoPostUrl('https://www.facebook.com/share/p/abc123'), true);
  assert.equal(isFacebookPhotoPostUrl('https://www.facebook.com/reel/123'), false);
  const html = String.raw`<meta property="og:title" content="Album"><script>
    {"image":"https:\/\/scontent.xx.fbcdn.net\/v\/t39.30808-6\/photo-a.jpg?_nc=1",
     "duplicate":"https:\/\/scontent.xx.fbcdn.net\/v\/t39.30808-6\/photo-a.jpg?_nc=1",
     "second":"https:\/\/scontent.xx.fbcdn.net\/v\/t39.30808-6\/photo-b.png?_nc=2",
     "thumbnail":"https:\/\/scontent.xx.fbcdn.net\/v\/t39.30808-1\/avatar.jpg?ctp=s50x50",
     "icon":"https:\/\/static.xx.fbcdn.net\/rsrc.php\/v4\/y1\/r\/icon.gif"}
  </script>`;
  assert.deepEqual(extractFacebookPostImageUrls(html), [
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/photo-a.jpg?_nc=1',
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/photo-b.png?_nc=2',
  ]);
});

test('Facebook page cookies are scoped to facebook hosts when sent for post inspection', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-facebook-cookie-header-'));
  const cookiePath = path.join(directory, 'cookies.txt');
  fs.writeFileSync(cookiePath, '# Netscape HTTP Cookie File\n.facebook.com\tTRUE\t/\tTRUE\t0\tc_user\t123\nexample.com\tTRUE\t/\tTRUE\t0\tbad\tnope\n');
  try {
    assert.equal(buildCookieHeaderFromNetscape(cookiePath, 'www.facebook.com'), 'c_user=123');
    assert.equal(buildCookieHeaderFromNetscape(cookiePath, 'scontent.xx.fbcdn.net'), '');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Facebook photo post downloader saves every discovered image in one folder', async () => {
  const html = '<meta property="og:title" content="Weekend album">'
    + 'https://scontent.xx.fbcdn.net/v/t39.30808-6/a.jpg?x=1 '
    + 'https://scontent.xx.fbcdn.net/v/t39.30808-6/b.png?x=2';
  const downloaded = [];
  let fetchOptions;
  const result = await downloadFacebookPhotoPost(
    'https://www.facebook.com/example/posts/123',
    async (url, headers, options) => {
      fetchOptions = options;
      return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: html };
    },
    async (url, destination) => { downloaded.push({ url, destination }); fs.writeFileSync(destination, 'image'); return destination; },
  );
  try {
    assert.equal(fetchOptions.maxBodyBytes, 16 * 1024 * 1024);
    assert.equal(result.success, true);
    assert.equal(result.downloadedImages, 2);
    assert.equal(downloaded.length, 2);
    assert.ok(downloaded.every(item => fs.existsSync(item.destination)));
  } finally {
    if (result.filePath) fs.rmSync(path.dirname(result.filePath), { recursive: true, force: true });
  }
});

test('Facebook extension captures are validated and bypass the noisy page scraper', async () => {
  const valid = [
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/post-a.jpg?cstp=1200x900',
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/post-b.jpg?cstp=1200x900',
  ];
  assert.equal(Boolean(isFacebookImageUrl(valid[0])), true);
  assert.equal(isFacebookImageUrl('https://scontent.xx.fbcdn.net/v/t39.30808-1/avatar.jpg?ctp=s50x50'), false);
  assert.equal(isFacebookImageUrl('https://static.xx.fbcdn.net/rsrc.php/icon.gif'), false);
  let fetchCalled = false;
  const downloaded = [];
  const result = await downloadFacebookPhotoPost(
    'https://www.facebook.com/share/p/1F5BkZh6xF/',
    async () => { fetchCalled = true; throw new Error('the page fallback should not run for captured images'); },
    async (url, destination) => { downloaded.push(url); fs.writeFileSync(destination, 'image'); return destination; },
    [...valid, valid[0]],
  );
  try {
    assert.equal(fetchCalled, false);
    assert.equal(result.downloadedImages, 2);
    assert.deepEqual(downloaded, valid);
  } finally { if (result.filePath) fs.rmSync(path.dirname(result.filePath), { recursive: true, force: true }); }
});

test('media batches ask once for format and quality, then share the selection across links', async () => {
  const prompts = [];
  const urls = Array.from({ length: 10 }, (_, index) => `https://www.youtube.com/watch?v=video${index}`);
  const selected = await chooseBatchMediaOptions(urls, async (options, title) => {
    prompts.push({ options, title });
    return prompts.length === 1 ? 'mp4' : '720';
  });
  assert.deepEqual(selected, { formatType: 'mp4', selectedQuality: '720' });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].title, /10/);
  assert.match(prompts[1].title, /ทั้งชุด/);
});

test('audio-only batches ask for MP3 once and ordinary file batches skip media prompts', async () => {
  let calls = 0;
  const audio = await chooseBatchMediaOptions([
    'https://www.youtube.com/watch?v=one',
    'https://youtu.be/two',
  ], async () => { calls += 1; return 'mp3'; });
  assert.deepEqual(audio, { formatType: 'mp3', selectedQuality: 'best' });
  assert.equal(calls, 1);
  const direct = await chooseBatchMediaOptions(['https://example.com/a.zip', 'https://example.com/b.zip'], async () => {
    throw new Error('Direct file batch must not ask media questions');
  });
  assert.equal(direct, null);
});

test('media playlists are detected without classifying ordinary watch URLs as playlists', () => {
  assert.equal(isLikelyMediaPlaylist('https://www.youtube.com/watch?v=abc&list=PL123'), true);
  assert.equal(isLikelyMediaPlaylist('https://www.youtube.com/playlist?list=PL123'), true);
  assert.equal(isLikelyMediaPlaylist('https://www.youtube.com/watch?v=abc'), false);
});

test('media cookie args prefer an explicitly selected browser and otherwise use cookies.txt', () => {
  assert.deepEqual(buildMediaCookieArgs('edge', 'cookies.txt'), ['--cookies-from-browser', 'edge']);
  assert.deepEqual(buildMediaCookieArgs('none', 'cookies.txt'), ['--cookies', 'cookies.txt']);
  assert.deepEqual(buildMediaCookieArgs('invalid-browser', 'cookies.txt'), ['--cookies', 'cookies.txt']);
  assert.deepEqual(buildMediaCookieArgs('none', ''), []);
});

test('startup creates a private-use Netscape cookie template and only activates it when populated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-cookie-template-'));
  const cookiePath = path.join(directory, 'cookies.txt');
  const created = ensureMediaCookiesFile(cookiePath);
  assert.equal(created.created, true);
  assert.equal(created.hasCookies, false);
  assert.match(fs.readFileSync(cookiePath, 'utf8'), /^# Netscape HTTP Cookie File/m);
  assert.equal(hasNetscapeCookieEntries(cookiePath), false);
  fs.writeFileSync(cookiePath, '# Netscape HTTP Cookie File\nyoutube.com\tTRUE\t/\tTRUE\t0\tSID\tprivate-value\n');
  assert.equal(hasNetscapeCookieEntries(cookiePath), true);
  const existing = ensureMediaCookiesFile(cookiePath);
  assert.equal(existing.created, false);
  assert.equal(fs.readFileSync(cookiePath, 'utf8').includes('private-value'), true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('cookie relay accepts Chromium extension origins but rejects normal web origins', () => {
  assert.equal(isAllowedCookieRelayOrigin(`chrome-extension://${'a'.repeat(32)}`), true);
  assert.equal(isAllowedCookieRelayOrigin('brave-extension://zelux-local'), true);
  assert.equal(isAllowedCookieRelayOrigin('edge-extension://extension_id'), true);
  assert.equal(isAllowedCookieRelayOrigin('moz-extension://12345678-1234-1234-1234-123456789abc'), true);
  assert.equal(isAllowedCookieRelayOrigin('https://www.facebook.com'), false);
  assert.equal(isAllowedCookieRelayOrigin('null'), false);
});

test('temporary Facebook cookie relay accepts one extension-origin request and scopes cookies to Facebook', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  let port = 0;
  const received = receiveTemporaryFacebookCookies(token, {
    port: 0,
    timeoutMs: 3000,
    onListening: value => { port = value; },
  });
  while (!port) await new Promise(resolve => setTimeout(resolve, 1));

  const rejectedOrigin = await new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port, path: '/challenge?nonce=' + 'a'.repeat(64),
      headers: { Origin: 'https://www.facebook.com' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.body.code, 'extension_origin_not_allowed');
  assert.equal(rejectedOrigin.body.appVersion, '1.8.8');
  assert.equal(rejectedOrigin.body.origin, 'https://www.facebook.com');

  const nonce = crypto.randomBytes(32).toString('hex');
  const challenge = await new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port, path: `/challenge?nonce=${nonce}`,
      headers: { Origin: `chrome-extension://${'a'.repeat(32)}` },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.proof, crypto.createHmac('sha256', Buffer.from(token, 'hex')).update(nonce, 'hex').digest('hex'));

  const noOriginNonce = crypto.randomBytes(32).toString('hex');
  const noOriginChallenge = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/challenge?nonce=${noOriginNonce}` }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
  assert.equal(noOriginChallenge.status, 200);
  assert.equal(noOriginChallenge.body.proof, crypto.createHmac('sha256', Buffer.from(token, 'hex')).update(noOriginNonce, 'hex').digest('hex'));

  async function post(headers, payload, origin = `chrome-extension://${'a'.repeat(32)}`) {
    return new Promise((resolve, reject) => {
      const requestHeaders = { 'Content-Type': 'application/json', ...headers };
      if (origin) requestHeaders.Origin = origin;
      const request = http.request({
        host: '127.0.0.1', port, path: '/cookies', method: 'POST',
        headers: requestHeaders,
      }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end(JSON.stringify(payload));
    });
  }

  assert.equal(await post({ 'X-Zelux-Token': '0'.repeat(64) }, { cookies: [] }), 403);
  assert.equal(await post({ 'X-Zelux-Token': token }, { cookies: [
    { domain: '.facebook.com', name: 'session', value: 'test-session', path: '/', secure: true, httpOnly: true },
    { domain: '.evil.example', name: 'steal', value: 'no', path: '/' },
  ] }, null), 200);
  const jar = await received;
  assert.match(jar, /#HttpOnly_\.facebook\.com\tTRUE\t\/\tTRUE\t0\tsession\ttest-session/);
  assert.doesNotMatch(jar, /evil|steal/);
});

test('temporary Facebook cookie files are constrained, private, and removed', () => {
  const cookies = [
    { domain: '.facebook.com', name: 'session', value: 'private-value', path: '/', secure: true, httpOnly: true },
    { domain: 'facebook.com.attacker.example', name: 'bad', value: 'ignored', path: '/' },
    { domain: 'facebook.com', name: 'bad\tname', value: 'ignored', path: '/' },
  ];
  const jar = formatFacebookCookies(cookies);
  assert.match(jar, /session\tprivate-value/);
  assert.doesNotMatch(jar, /attacker|bad/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-cookie-test-'));
  try {
    const filePath = writeTemporaryFacebookCookies(cookies, directory);
    assert.match(path.basename(filePath), /^zelux-facebook-[a-f0-9]{32}\.txt$/);
    assert.match(fs.readFileSync(filePath, 'utf8'), /private-value/);
    assert.equal(removeTemporaryFacebookCookies(filePath), true);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(removeTemporaryFacebookCookies(path.join(directory, 'unrelated.txt')), false);
    const stalePath = path.join(directory, `zelux-facebook-${'a'.repeat(32)}.txt`);
    fs.writeFileSync(stalePath, 'stale');
    fs.utimesSync(stalePath, new Date(0), new Date(0));
    assert.equal(cleanupStaleTemporaryFacebookCookies(directory, Date.now(), 1000), 1);
    assert.equal(fs.existsSync(stalePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('temporary YouTube cookies are scoped to youtube.com and cleaned after the job', () => {
  const cookies = [
    { domain: '.youtube.com', name: 'SID', value: 'youtube-secret', path: '/', secure: true, httpOnly: true },
    { domain: '.google.com', name: 'SID', value: 'google-secret', path: '/', secure: true, httpOnly: true },
    { domain: 'youtube.com.attacker.example', name: 'bad', value: 'ignored', path: '/' },
    { domain: '.youtube.com', name: 'bad\tname', value: 'ignored', path: '/' },
  ];
  const jar = formatYouTubeCookies(cookies);
  assert.match(jar, /#HttpOnly_\.youtube\.com\tTRUE\t\/\tTRUE\t0\tSID\tyoutube-secret/);
  assert.doesNotMatch(jar, /google-secret|attacker|bad/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-youtube-cookie-test-'));
  try {
    const filePath = writeTemporaryYouTubeCookies(cookies, directory);
    assert.match(path.basename(filePath), /^zelux-youtube-[a-f0-9]{32}\.txt$/);
    assert.match(fs.readFileSync(filePath, 'utf8'), /youtube-secret/);
    assert.equal(removeTemporaryYouTubeCookies(filePath), true);
    assert.equal(fs.existsSync(filePath), false);
    const stalePath = path.join(directory, `zelux-youtube-${'b'.repeat(32)}.txt`);
    fs.writeFileSync(stalePath, 'stale');
    fs.utimesSync(stalePath, new Date(0), new Date(0));
    assert.equal(cleanupStaleTemporaryYouTubeCookies(directory, Date.now(), 1000), 1);
    assert.equal(fs.existsSync(stalePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('temporary media cookie file is removed even when the download action fails', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-temp-cookie-cleanup-'));
  try {
    const filePath = writeTemporaryYouTubeCookies([
      { domain: '.youtube.com', name: 'SID', value: 'temporary', path: '/', secure: true, httpOnly: true },
    ], directory);
    await assert.rejects(withTemporaryMediaCookies(filePath, async () => {
      assert.equal(fs.existsSync(filePath), true);
      throw new Error('simulated cancel/failure');
    }), /simulated cancel\/failure/);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('temporary YouTube cookie bridge accepts only YouTube cookies', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  let port = 0;
  const received = receiveTemporaryMediaCookies(token, 'youtube', {
    port: 0,
    timeoutMs: 3000,
    onListening: value => { port = value; },
  });
  while (!port) await new Promise(resolve => setTimeout(resolve, 1));

  const post = payload => new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path: '/cookies', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zelux-Token': token },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(JSON.stringify(payload));
  });

  assert.equal(await post({ provider: 'youtube', cookies: [
    { domain: '.youtube.com', name: 'SID', value: 'only-youtube', path: '/', secure: true, httpOnly: true },
    { domain: '.google.com', name: 'SID', value: 'must-not-enter', path: '/' },
  ] }), 200);
  const jar = await received;
  assert.match(jar, /only-youtube/);
  assert.doesNotMatch(jar, /must-not-enter|facebook/);
});

test('temporary YouTube cookie bridge rejects a Facebook payload', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  let port = 0;
  const received = receiveTemporaryMediaCookies(token, 'youtube', {
    port: 0,
    timeoutMs: 3000,
    onListening: value => { port = value; },
  });
  const rejection = assert.rejects(received, /provider did not match/i);
  while (!port) await new Promise(resolve => setTimeout(resolve, 1));
  const status = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path: '/cookies', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zelux-Token': token },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ provider: 'facebook', cookies: [{ domain: '.facebook.com', name: 'SID', value: 'wrong-provider' }] }));
  });
  assert.equal(status, 400);
  await rejection;
});

test('ZELUX protocol keeps the one-time cookie token separate from download URLs', () => {
  const token = 'a'.repeat(64);
  const exePath = 'D:\\Zelux-DL\\ZELUX-DL.exe';
  const request = decodeZeluxProtocolRequest(`zelux://download?urls=${encodeURIComponent(JSON.stringify(['https://www.facebook.com/reel/123']))}&cookieToken=${token}&exePath=${encodeURIComponent(exePath)}`);
  assert.deepEqual(request, { urls: ['https://www.facebook.com/reel/123'], cookieToken: token, exePath });
  assert.deepEqual(decodeZeluxProtocolRequest('zelux://download?url=https%3A%2F%2Fexample.com%2Ffile.zip&cookieToken=invalid'), {
    urls: ['https://example.com/file.zip'], cookieToken: '', exePath: '',
  });
});

test('ZELUX protocol accepts only validated Facebook image captures', () => {
  const images = [
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/a.jpg?cstp=1200x900',
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/b.jpg?cstp=1200x900',
    'https://static.xx.fbcdn.net/rsrc.php/icon.gif',
  ];
  const encoded = encodeURIComponent(JSON.stringify(images));
  const request = decodeZeluxProtocolRequest(`zelux://download?urls=${encodeURIComponent(JSON.stringify(['https://www.facebook.com/share/p/1F5BkZh6xF/']))}&imageUrls=${encoded}`);
  assert.deepEqual(request.facebookImageUrls, images.slice(0, 2));
});

test('configured executable path accepts only an absolute Windows ZELUX-DL.exe path', () => {
  assert.equal(normalizeZeluxExePath('D:\\Zelux-DL\\ZELUX-DL.exe'), 'D:\\Zelux-DL\\ZELUX-DL.exe');
  assert.equal(normalizeZeluxExePath('"D:\\Zelux-DL\\ZELUX-DL.exe"'), 'D:\\Zelux-DL\\ZELUX-DL.exe');
  assert.equal(normalizeZeluxExePath('C:/Apps/ZELUX-DL.exe'), 'C:\\Apps\\ZELUX-DL.exe');
  assert.equal(normalizeZeluxExePath('ZELUX-DL.exe'), '');
  assert.equal(normalizeZeluxExePath('C:\\Apps\\another.exe'), '');
  assert.equal(normalizeZeluxExePath('\\\\server\\share\\ZELUX-DL.exe'), '');
});

test('protocol handoff validates the configured app and opens that exact executable with the original request', async () => {
  let launch = null;
  let verifiedPath = '';
  const protocolArg = 'zelux://download?urls=%5B%5D&exePath=D%3A%5CZelux-DL%5CZELUX-DL.exe';
  const didHandoff = await handoffToConfiguredZeluxExe('D:\\Zelux-DL\\ZELUX-DL.exe', protocolArg, {
    platform: 'win32',
    currentExePath: 'C:\\Registered\\ZELUX-DL.exe',
    statFile: () => ({ isFile: () => true }),
    verifyIdentity: exePath => { verifiedPath = exePath; },
    startProcess: async (...args) => {
      launch = args;
      return 1234;
    },
  });
  assert.equal(didHandoff, true);
  assert.equal(verifiedPath, 'D:\\Zelux-DL\\ZELUX-DL.exe');
  assert.deepEqual(launch, ['D:\\Zelux-DL\\ZELUX-DL.exe', protocolArg]);
});

test('protocol handoff does not respawn itself or accept a missing executable', async () => {
  const sameExecutable = await handoffToConfiguredZeluxExe('D:\\Zelux-DL\\ZELUX-DL.exe', 'zelux://download', {
    platform: 'win32',
    currentExePath: 'd:\\zelux-dl\\zelux-dl.exe',
    statFile: () => ({ isFile: () => true }),
    verifyIdentity: () => assert.fail('The running ZELUX-DL app should not need to verify itself again.'),
    startProcess: () => assert.fail('The running app must not relaunch itself.'),
  });
  assert.equal(sameExecutable, false);
  await assert.rejects(
    handoffToConfiguredZeluxExe('D:\\Missing\\ZELUX-DL.exe', 'zelux://download', {
      platform: 'win32',
      currentExePath: 'C:\\Registered\\ZELUX-DL.exe',
      statFile: () => { throw new Error('ENOENT'); },
    }),
    /ZELUX-DL.exe was not found/,
  );
});

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

test('extractUrlsFromText cleans the supplied YouTube batch copied with Markdown escapes', () => {
  const pasted = String.raw`**https\://youtube.com/watch?v=xln2zsmvxPg&si=MaD2te-IuxecBRTK&#xD;**\
**https\://youtu.be/zN1YY7THiPU?si=nii8tmOdPYD73RAZ&#xD;**\
**https\://youtu.be/Ng56Dxajk5I?si=dhwTcYd3la7sq_Rq&#xD;**\
**https\://youtu.be/elX2LSaj9O4?si=9Ec0chrLHYDCtRBb&#xD;**\
**https\://youtu.be/9AQnYYHHuMg?si=ggt6iPJ4zzglAJ33&#xD;**\
**https\://youtu.be/Psdh1XVfRAw?si=rY5H-EL0slOTBD2l&#xD;**\
**https\://youtu.be/75tcmYwnNR4?si=UzA69bE6uc3wg6Oa&#xD;**\
**https\://youtu.be/Ry7mNsFdP0M?si=zBfB--2uKiXjBzu0&#xD;**\
**https\://youtu.be/h4m3krflE9I?si=WgfgL9L5LYL1Rmok&#xD;**\
**https\://youtu.be/IQjzVuO2KM8?si=D-Ie4zYLQNoq93xB**`;
  const urls = extractUrlsFromText(pasted);
  assert.equal(urls.length, 10);
  assert.equal(urls[0], 'https://youtube.com/watch?v=xln2zsmvxPg&si=MaD2te-IuxecBRTK');
  assert.equal(urls[9], 'https://youtu.be/IQjzVuO2KM8?si=D-Ie4zYLQNoq93xB');
  assert.ok(urls.every(url => isValidUrl(url) && !/[\\*]|&#xD;/i.test(url)));
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

test('extension sends pasted batches through the protocol without a page scanner', async () => {
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
    storage: { local: { get: async () => ({ zeluxExePath: 'D:\\Zelux-DL\\ZELUX-DL.exe' }) } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} },
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
  vm.runInNewContext(source, { chrome, console, encodeURIComponent, URLSearchParams, setTimeout });
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

  assert.equal(response.ok, true, response.error);
  assert.equal(response.count, 2);
  assert.equal(execution.target.tabId, 42);
  const protocol = new URL(execution.args[0]);
  assert.equal(protocol.searchParams.get('urls'), JSON.stringify(urls));
  assert.equal(protocol.searchParams.get('exePath'), 'D:\\Zelux-DL\\ZELUX-DL.exe');
  const markup = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'popup.html'), 'utf8');
  const popupSource = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'popup.js'), 'utf8');
  assert.doesNotMatch(markup, /scanBtn|scan this page/i);
  assert.doesNotMatch(popupSource, /scan-page|scanButton/);
  assert.match(popupSource, /type: 'launch-download'/);
  assert.match(popupSource, /message\.urls|urls,/);
  assert.match(popupSource, /launchProtocolFromPopup\(protocolUrl\)/);
  assert.match(popupSource, /Approve Brave’s one-time Facebook and local-app permission prompt/);
});

test('extension reads only Facebook cookies after explicit opt-in and sends them only to loopback', async () => {
  const listeners = {};
  let cookieQuery = null;
  let permissionRemoval = null;
  let posted = null;
  let protocolUrl = '';
  let expectedToken = '0a'.repeat(32);
  let forgeChallenge = false;
  const relayCalls = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: listener => { listeners.message = listener; } },
    },
    contextMenus: { create: () => {}, removeAll: callback => callback(), onClicked: { addListener: () => {} } },
    storage: { local: { get: async () => ({ zeluxExePath: 'D:\\Zelux-DL\\ZELUX-DL.exe' }) } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} },
    tabs: { get: async tabId => ({ id: tabId, url: 'https://www.facebook.com/reel/123' }) },
    cookies: { getAll: async query => {
      cookieQuery = query;
      return [
        { domain: '.facebook.com', name: 'session', value: 'sensitive-test-value', path: '/', secure: true, httpOnly: true },
        { domain: '.other.example', name: 'unrelated', value: 'must-not-send', path: '/' },
      ];
    } },
    permissions: { remove: async value => { permissionRemoval = value; return true; } },
    scripting: { executeScript: async options => { protocolUrl = options.args?.[0] || ''; } },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'background.js'), 'utf8');
  vm.runInNewContext(source, {
    chrome, console, encodeURIComponent, URL, URLSearchParams, Uint8Array, AbortController, setTimeout, clearTimeout,
    crypto: { getRandomValues: bytes => { bytes.fill(10); return bytes; }, subtle: crypto.webcrypto.subtle },
    fetch: async (url, options = {}) => {
      relayCalls.push(url);
      if (url.includes('/challenge?')) {
        const nonce = new URL(url).searchParams.get('nonce');
        const proof = forgeChallenge
          ? 'f'.repeat(64)
          : crypto.createHmac('sha256', Buffer.from(expectedToken, 'hex')).update(nonce, 'hex').digest('hex');
        return { ok: true, status: 200, json: async () => ({ proof }) };
      }
      posted = { url, options };
      return { ok: true, status: 200 };
    },
  });

  const result = await new Promise(resolve => {
    listeners.message({
      type: 'launch-download',
      urls: ['https://www.facebook.com/reel/123'],
      tabId: 17,
      includeFacebookCookies: true,
    }, {}, resolve);
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(cookieQuery.url, 'https://www.facebook.com/reel/123');
  assert.equal(posted.url, 'http://127.0.0.1:47821/cookies');
  assert.match(relayCalls[0], /^http:\/\/127\.0\.0\.1:47821\/challenge\?nonce=/);
  assert.equal(relayCalls[1], posted.url);
  assert.match(posted.options.headers['X-Zelux-Token'], /^[a-f0-9]{64}$/);
  assert.match(posted.options.body, /sensitive-test-value/);
  assert.doesNotMatch(posted.options.body, /must-not-send/);
  const protocol = new URL(protocolUrl);
  assert.equal(protocol.searchParams.get('cookieToken'), posted.options.headers['X-Zelux-Token']);
  assert.equal(protocol.searchParams.get('exePath'), 'D:\\Zelux-DL\\ZELUX-DL.exe');
  assert.doesNotMatch(protocolUrl, /sensitive-test-value/);
  assert.deepEqual(Array.from(permissionRemoval.permissions), ['cookies']);
  assert.equal(result.usedTemporaryCookies, true);

  // Facebook downloads launched directly by the popup must send the same
  // one-time token without trying to trigger the protocol a second time.
  protocolUrl = '';
  expectedToken = 'b'.repeat(64);
  posted = null;
  const directResult = await new Promise(resolve => listeners.message({
    type: 'launch-download',
    urls: ['https://www.facebook.com/reel/123'],
    tabId: 17,
    includeFacebookCookies: true,
    cookieToken: expectedToken,
    protocolAlreadyLaunched: true,
  }, {}, resolve));
  assert.equal(directResult.ok, true, directResult.error);
  assert.equal(directResult.count, 1);
  assert.equal(protocolUrl, '');
  assert.equal(posted.options.headers['X-Zelux-Token'], expectedToken);

  forgeChallenge = true;
  posted = null;
  relayCalls.length = 0;
  const blocked = await new Promise(resolve => {
    listeners.message({
      type: 'launch-download',
      urls: ['https://www.facebook.com/reel/123'],
      tabId: 17,
      includeFacebookCookies: true,
    }, {}, resolve);
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /identity verification failed/i);
  assert.equal(relayCalls.length, 1);
  assert.equal(posted, null);
});

test('extension reads only YouTube cookies after explicit opt-in and sends them only to loopback', async () => {
  const listeners = {};
  let cookieQuery = null;
  let posted = null;
  let protocolUrl = '';
  const expectedToken = '1b'.repeat(32);
  const removedPermissions = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: listener => { listeners.message = listener; } },
    },
    contextMenus: { create: () => {}, removeAll: callback => callback(), onClicked: { addListener: () => {} } },
    storage: { local: { get: async () => ({ zeluxExePath: 'D:\\Zelux-DL\\ZELUX-DL.exe' }) } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} },
    tabs: { get: async tabId => ({ id: tabId, url: 'https://www.youtube.com/watch?v=video' }) },
    cookies: { getAll: async query => {
      cookieQuery = query;
      return [
        { domain: '.youtube.com', name: 'SID', value: 'youtube-secret', path: '/', secure: true, httpOnly: true },
        { domain: '.google.com', name: 'SID', value: 'google-must-not-send', path: '/', secure: true, httpOnly: true },
      ];
    } },
    permissions: { remove: async value => { removedPermissions.push(value); return true; } },
    scripting: { executeScript: async options => { protocolUrl = options.args?.[0] || ''; } },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'background.js'), 'utf8');
  vm.runInNewContext(source, {
    chrome, console, encodeURIComponent, URL, URLSearchParams, Uint8Array, AbortController, setTimeout, clearTimeout,
    crypto: { getRandomValues: bytes => { bytes.set(Buffer.from(expectedToken, 'hex')); return bytes; }, subtle: crypto.webcrypto.subtle },
    fetch: async (url, options = {}) => {
      if (url.includes('/challenge?')) {
        const nonce = new URL(url).searchParams.get('nonce');
        const proof = crypto.createHmac('sha256', Buffer.from(expectedToken, 'hex')).update(nonce, 'hex').digest('hex');
        return { ok: true, status: 200, json: async () => ({ proof }) };
      }
      posted = { url, options };
      return { ok: true, status: 200 };
    },
  });

  const result = await new Promise(resolve => listeners.message({
    type: 'launch-download',
    urls: ['https://youtu.be/video'],
    tabId: 18,
    includeYouTubeCookies: true,
    cookieToken: expectedToken,
    protocolAlreadyLaunched: true,
  }, {}, resolve));
  assert.equal(result.ok, true, result.error);
  assert.equal(cookieQuery.url, 'https://www.youtube.com/');
  assert.equal(posted.url, 'http://127.0.0.1:47821/cookies');
  assert.match(posted.options.body, /"provider":"youtube"/);
  assert.match(posted.options.body, /youtube-secret/);
  assert.doesNotMatch(posted.options.body, /google-must-not-send/);
  assert.equal(posted.options.headers['X-Zelux-Token'], expectedToken);
  assert.equal(protocolUrl, '');
  assert.equal(result.usedTemporaryCookies, true);
  assert.equal(removedPermissions.length, 1);
  assert.deepEqual(Array.from(removedPermissions[0].origins), ['https://youtube.com/*', 'https://*.youtube.com/*', 'http://127.0.0.1/*']);
});

test('extension blocks capture before reading cookies when the configured path is not a ZELUX-DL executable', async () => {
  const listeners = {};
  let cookieReads = 0;
  let protocolLaunches = 0;
  const chrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: listener => { listeners.message = listener; } },
    },
    contextMenus: { create: () => {}, removeAll: callback => callback(), onClicked: { addListener: () => {} } },
    storage: { local: { get: async () => ({ zeluxExePath: 'C:\\Apps\\not-zelux.exe' }) } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} },
    tabs: { get: async () => ({ id: 9, url: 'https://www.facebook.com/reel/123' }) },
    cookies: { getAll: async () => { cookieReads += 1; return [{ domain: '.facebook.com', name: 'session', value: 'secret' }]; } },
    permissions: { remove: async () => true },
    scripting: { executeScript: async () => { protocolLaunches += 1; } },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'zelux-extension', 'background.js'), 'utf8');
  vm.runInNewContext(source, { chrome, console, encodeURIComponent, URL, URLSearchParams, Uint8Array, setTimeout });
  const response = await new Promise(resolve => listeners.message({
    type: 'launch-download',
    urls: ['https://www.facebook.com/reel/123'],
    tabId: 9,
    includeFacebookCookies: true,
  }, {}, resolve));
  assert.equal(response.ok, false);
  assert.match(response.error, /set the ZELUX-DL executable path/i);
  assert.equal(cookieReads, 0);
  assert.equal(protocolLaunches, 0);
});

test('extension settings require an explicit local ZELUX-DL executable path', () => {
  const root = path.join(__dirname, '..', 'zelux-extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const markup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  assert.ok(manifest.permissions.includes('storage'));
  assert.match(markup, /id="settingsToggle"/);
  assert.match(markup, /id="exePathInput"/);
  assert.match(markup, /id="saveExePathBtn"/);
  assert.match(markup, /id="setupNotice"/);
  assert.match(script, /sendButton\.disabled = count === 0 \|\| !configuredExePath/);
  assert.match(script, /chrome\.storage\.local\.set\(\{ zeluxExePath: exePath \}/);
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

test('batch cover post-processing embeds metadata and artwork from local files without invoking yt-dlp', () => {
  const mediaPath = 'D:\\Downloads\\Music\\track.mp3';
  const thumbnailPath = `${mediaPath}.webp`;
  const tempPath = 'D:\\Downloads\\Music\\track.zelux-123.mp3';
  const args = buildMediaPostprocessArgs({ title: 'Track', artist: 'Artist', upload_date: '20260927' }, mediaPath, thumbnailPath, tempPath);
  assert.deepEqual(args.slice(0, 4), ['-y', '-i', mediaPath, '-i']);
  assert.ok(args.includes(thumbnailPath));
  assert.ok(args.includes('-map'));
  assert.ok(args.includes('0:a:0'));
  assert.ok(args.includes('1:v:0'));
  assert.ok(args.includes('-disposition:v:0'));
  assert.ok(args.includes('attached_pic'));
  assert.ok(args.includes('title=Track'));
  assert.ok(args.includes('artist=Artist'));
  assert.ok(args.includes('date=2026-09-27'));
  assert.equal(args.at(-1), tempPath);
  assert.ok(!args.includes('--load-info-json'));
});

test('media post-processing updates the downloaded file using a local cover and never invokes yt-dlp', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-postprocess-runner-'));
  const mediaPath = path.join(directory, 'clip.mp3');
  const thumbnailPath = `${mediaPath}.webp`;
  const infoPath = path.join(directory, 'clip.info.json');
  fs.writeFileSync(mediaPath, 'completed');
  fs.writeFileSync(thumbnailPath, 'cover');
  fs.writeFileSync(infoPath, JSON.stringify({ title: 'Clip', thumbnails: [{ filepath: thumbnailPath }] }));
  let invocation;
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  const resultPromise = postprocessMediaInfoJson('yt-dlp.exe', infoPath, 'ffmpeg.exe', mediaPath, (...args) => {
    invocation = args;
    fs.writeFileSync(args[1].at(-1), 'embedded');
    return child;
  });
  child.emit('close', 0);
  assert.deepEqual(await resultPromise, { success: true });
  assert.equal(invocation[0], 'ffmpeg.exe');
  assert.ok(invocation[1].includes(mediaPath));
  assert.ok(invocation[1].includes(thumbnailPath));
  assert.equal(fs.readFileSync(mediaPath, 'utf8'), 'embedded');
  assert.equal(fs.readdirSync(directory).some(name => name.includes('backup') || name.includes('.zelux-')), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('yt-dlp after-move output preserves the actual final path and media ID', () => {
  assert.deepEqual(
    parseYtDlpAfterMovePath('__ZELUX_MEDIA_FILE__abc123|E:\\Downloads\\Music\\ชื่อเพลง (1).mp3'),
    { id: 'abc123', filePath: 'E:\\Downloads\\Music\\ชื่อเพลง (1).mp3' },
  );
  assert.equal(parseYtDlpAfterMovePath('ordinary progress output'), null);
  assert.equal(parseYtDlpAfterMovePath('__ZELUX_MEDIA_FILE__missing-path'), null);
});

test('media post-processing skips a missing completed file instead of downloading it again', async () => {
  let spawned = false;
  const result = await postprocessMediaInfoJson('yt-dlp.exe', 'clip.info.json', 'ffmpeg', 'missing-clip.mp4', () => {
    spawned = true;
    return new EventEmitter();
  });
  assert.equal(spawned, false);
  assert.equal(result.success, false);
  assert.match(result.error, /ไม่เริ่มดาวน์โหลดซ้ำ/);
});

test('media post-processing reports a missing local cover without starting a downloader', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-postprocess-warning-'));
  const mediaPath = path.join(directory, 'clip.mp3');
  fs.writeFileSync(mediaPath, 'completed');
  const infoPath = path.join(directory, 'clip.info.json');
  fs.writeFileSync(infoPath, JSON.stringify({ title: 'Clip' }));
  let spawned = false;
  const result = await postprocessMediaInfoJson('yt-dlp.exe', infoPath, 'ffmpeg', mediaPath, () => { spawned = true; });
  assert.equal(spawned, false);
  assert.equal(result.success, false);
  assert.match(result.error, /ไม่พบไฟล์ภาพปก/);
  assert.equal(fs.readFileSync(mediaPath, 'utf8'), 'completed');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('cleanupMediaInfoJson removes only sidecars listed inside the info JSON directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-cover-cleanup-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-cover-outside-'));
  const infoPath = path.join(root, 'clip.info.json');
  const localCover = path.join(root, 'clip.jpg');
  const staleCover = path.join(root, 'clip.png');
  const ytDlpCover = path.join(root, 'clip.mp4.webp');
  const externalCover = path.join(outside, 'keep.jpg');
  fs.writeFileSync(localCover, 'cover');
  fs.writeFileSync(staleCover, 'cover');
  fs.writeFileSync(ytDlpCover, 'cover');
  fs.writeFileSync(externalCover, 'keep');
  fs.writeFileSync(infoPath, JSON.stringify({ thumbnails: [{ filepath: localCover }, { filepath: externalCover }] }));
  assert.deepEqual(listInfoJsonFiles(root), [infoPath]);
  cleanupMediaInfoJson(infoPath, path.join(root, 'clip.mp4'));
  assert.equal(fs.existsSync(infoPath), false);
  assert.equal(fs.existsSync(localCover), false);
  assert.equal(fs.existsSync(staleCover), false);
  assert.equal(fs.existsSync(ytDlpCover), false);
  assert.equal(fs.existsSync(externalCover), true);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
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

test('Windows update handoff waits, verifies the replacement, and leaves restart to the user', () => {
  const script = buildWindowsUpdateScript();
  assert.match(script, /Updater started; waiting for process/);
  assert.match(script, /Get-Process -Id \$ParentPid/);
  assert.match(script, /for \(\$Attempt = 1; \$Attempt -le 20/);
  assert.match(script, /FileVersionInfo\]::GetVersionInfo\(\$ExePath\)\.FileVersion/);
  assert.match(script, /\$NormalizedVersion -ne \$ExpectedVersion/);
  assert.doesNotMatch(script, /Start-Process -FilePath \$ExePath -WorkingDirectory \$WorkDir -PassThru/);
  assert.match(script, /Update complete; waiting for manual restart/);
  assert.match(script, /Restored the previous executable\. Manual restart is required/);
  assert.match(script, /\[string\]\$LogPath/);
  assert.match(script, /Write-UpdateLog "Update failed:/);
});

test('Windows updater uses a PowerShell Start-Process launcher instead of Node detached PowerShell', () => {
  const launcher = buildWindowsUpdateLauncherScript();
  assert.match(launcher, /Start-Process -FilePath \$PowerShellPath -ArgumentList \$ArgumentLine/);
  assert.match(launcher, /Updater started; waiting for process/);
  assert.match(launcher, /Stop-Process -Id \$Helper\.Id -Force/);
  assert.equal(quoteWindowsArgument('D:\\Folder With Spaces\\ZELUX-DL.exe'), '"D:\\Folder With Spaces\\ZELUX-DL.exe"');
  assert.equal(quoteWindowsArgument('D:\\Trailing\\'), '"D:\\Trailing\\\\"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
});

test('Windows updater launcher actually starts its detached helper', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux updater launcher '));
  const scriptPath = path.join(directory, '_update.ps1');
  const launcherPath = path.join(directory, '_launcher.ps1');
  const logPath = path.join(directory, '_update.log');
  const fakeParent = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
    stdio: 'ignore', windowsHide: true,
  });
  t.after(() => {
    try { fakeParent.kill(); } catch (_) { /* The process may already have exited. */ }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await new Promise((resolve, reject) => {
    fakeParent.once('spawn', resolve);
    fakeParent.once('error', reject);
  });
  fs.writeFileSync(scriptPath, buildWindowsUpdateScript(), 'utf8');
  fs.writeFileSync(launcherPath, buildWindowsUpdateLauncherScript(), 'utf8');
  fs.writeFileSync(logPath, '', 'utf8');
  const powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helperArgs = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', scriptPath,
    '-ParentPid', String(fakeParent.pid),
    '-ExePath', path.join(directory, 'not-used.exe'),
    '-TempPath', path.join(directory, 'missing.update'),
    '-BackupPath', path.join(directory, 'not-used.backup'),
    '-WorkDir', directory,
    '-LogPath', logPath,
    '-ExpectedVersion', '1.8.6',
  ];
  const launcher = require('child_process').spawn(powershellPath, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', launcherPath,
    '-PowerShellPath', powershellPath,
    '-ArgumentLine', helperArgs.map(quoteWindowsArgument).join(' '),
    '-WorkDir', directory,
    '-LogPath', logPath,
  ], { cwd: directory, stdio: 'ignore', windowsHide: true });
  const ready = waitForUpdateHelperReady(launcher, logPath, 5000);
  await ready;
  assert.match(fs.readFileSync(logPath, 'utf8'), /Updater started; waiting for process/);
  fakeParent.kill();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !fs.readFileSync(logPath, 'utf8').includes('Update failed: The verified update file is missing.')) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(fs.readFileSync(logPath, 'utf8'), /Update failed: The verified update file is missing/);
  await new Promise(resolve => setTimeout(resolve, 200));
});

test('Windows updater handoff does not proceed until the PowerShell helper reports ready', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zelux-update-helper-'));
  const logPath = path.join(tempDir, 'update.log');
  const child = new EventEmitter();
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const ready = waitForUpdateHelperReady(child, logPath, 500);
  setTimeout(() => fs.writeFileSync(logPath, 'Updater started; waiting for process 123.\n'), 25);
  await ready;

  const exitedChild = new EventEmitter();
  const exited = waitForUpdateHelperReady(exitedChild, path.join(tempDir, 'missing.log'), 500);
  exitedChild.emit('exit', 1, null);
  await assert.rejects(exited, /exited before it was ready/);
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
