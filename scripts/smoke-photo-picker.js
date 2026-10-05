// Browser UI smoke using production popup files and the live TikTok capture.
// Chrome APIs are stubbed only at the extension boundary; no cookies are read.
// Start session tiktok-photos on the target post, then pass playwright-cli.js.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const cli = process.argv[2];
if (!cli || !fs.existsSync(cli)) throw new Error('Supply playwright-cli.js');
const root = path.resolve(__dirname, '..');
const run = (session, ...args) => {
  const result = spawnSync(process.execPath, [cli, `-s=${session}`, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
  if (result.status !== 0 || /### Error/.test(result.stdout)) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout;
};
const parse = value => JSON.parse(value.match(/### Result\r?\n([\s\S]*?)\r?\n### Ran/)?.[1] || 'null');
const source = fs.readFileSync(path.join(root, 'zelux-extension/tiktok-photos.js'), 'utf8');
const post = parse(run('tiktok-photos', 'eval', `() => { ${source}; return ZeluxTikTokPhotos.captureDocument(document, location.href); }`));
assert.equal(post?.images.length, 19, 'Live carousel must contain 19 photos');
const assets = ['popup.html', 'popup.css', 'popup.js', 'photo-selection.js', 'tiktok-photos.js'].map(name => ({ name, body: fs.readFileSync(path.join(root, 'zelux-extension', name), 'utf8'), type: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' }));
const output = path.join(root, 'output/playwright');
fs.mkdirSync(output, { recursive: true });
run('photo-picker', 'open', 'about:blank', '--headed');
const code = `async (page) => {
  const assets = ${JSON.stringify(assets)};
  await page.route('http://127.0.0.1:18742/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const asset = assets.find(a => a.name === name);
    if (asset) return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
    if (name === 'icon48.png') return route.fulfill({ path: ${JSON.stringify(path.join(root, 'zelux-extension/icon48.png'))}, contentType: 'image/png' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(post => {
    window.__launch = null;
    window.chrome = {
      runtime: { getManifest: () => ({version: ${JSON.stringify(require('../zelux-extension/manifest.json').version)}}), onMessage: { addListener() {} }, sendMessage: async message => { window.__launch = message; return {ok:true,count:1}; } },
      storage: { local: { get: (_, cb) => cb({zeluxExePath:'D:\\\\Zelux-DL\\\\ZELUX-DL.exe'}), set: (_, cb) => cb() } },
      tabs: { query: async () => [{id:1,url:post.sourceUrl,title:'TikTok · 19 รูป'}] },
      permissions: { remove: async () => true, request: async () => true },
      scripting: { executeScript: async options => options.files ? [] : [{result:post}] },
    };
  }, ${JSON.stringify(post)});
  await page.goto('http://127.0.0.1:18742/popup.html');
  await page.setViewportSize({width:372,height:600});
  await page.locator('#photoPicker:not([hidden])').waitFor();
  if (await page.locator('.photo-tile').count() !== 9) throw new Error('Page one does not have 9 tiles');
  await page.locator('#clearPhotos').click();
  if (!await page.locator('#sendBtn').isDisabled()) throw new Error('Empty selection can be sent');
  await page.locator('[data-photo="1"]').click();
  await page.locator('#nextPhotos').click();
  if (!await page.locator('#photoPage').textContent().then(t => t.includes('10–18'))) throw new Error('Page two numbers incorrect');
  await page.locator('[data-photo="10"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.photo-tile img')].every(i=>i.complete && i.naturalWidth > 0));
  const firstLayout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, available: document.documentElement.clientWidth, height: document.documentElement.scrollHeight }));
  if (firstLayout.width > firstLayout.available || firstLayout.height > 600) throw new Error('Nine-photo popup does not fit 372 x 600');
  await page.screenshot({path:${JSON.stringify(path.join(output, 'photo-picker-page2.png'))}});
  await page.locator('#nextPhotos').click();
  if (await page.locator('.photo-tile').count() !== 1) throw new Error('Last page should show only photo 19');
  await page.locator('[data-photo="19"]').click();
  await page.locator('#selectAllPhotos').click();
  if (!await page.locator('#photoSelectionCount').textContent().then(t=>t.includes('19 จาก 19'))) throw new Error('Select all is not global');
  await page.locator('#clearPhotos').click();
  await page.locator('[data-photo="19"]').click();
  await page.locator('#previousPhotos').click(); await page.locator('[data-photo="10"]').click();
  await page.locator('#previousPhotos').click(); await page.locator('[data-photo="1"]').click();
  await page.locator('#nextPhotos').click();
  if (await page.locator('[data-photo="10"]').getAttribute('aria-pressed') !== 'true') throw new Error('Selection lost across pages');
  await page.locator('#nextPhotos').click();
  if (await page.locator('[data-photo="19"]').getAttribute('aria-pressed') !== 'true') throw new Error('Selection lost on last page');
  await page.waitForFunction(() => [...document.querySelectorAll('.photo-tile img')].every(i=>i.complete && i.naturalWidth > 0));
  await page.screenshot({path:${JSON.stringify(path.join(output, 'photo-picker-page3.png'))}});
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.kind === 'success');
  const data = await page.evaluate(() => window.__launch);
  if (JSON.stringify(data.photoSelection) !== JSON.stringify({total:19,positions:[1,10,19]})) throw new Error('Wrong selection sent');
  if (data.tikTokPost.images.length !== 3) throw new Error('Unselected photos were transported');
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, broken: [...document.querySelectorAll('.photo-tile img')].filter(i=>i.hidden).length }));
  if (layout.overflow) throw new Error('Popup has horizontal overflow');
}`;
const generatedCode = path.join(output, 'photo-picker-browser-smoke.js');
fs.writeFileSync(generatedCode, code);
run('photo-picker', 'run-code', `--filename=${generatedCode}`);
const message = parse(run('photo-picker', 'eval', '() => window.__launch'));
assert.deepEqual(message.photoSelection, { total: 19, positions: [1, 10, 19] });
const report = { selected: message.photoSelection.positions, postImages: 19, transportedImages: message.tikTokPost.images.length, screenshots: ['photo-picker-page2.png', 'photo-picker-page3.png'], cookieAccess: false };
fs.writeFileSync(path.join(output, 'photo-picker-smoke.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
