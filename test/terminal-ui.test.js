const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { stripVTControlCharacters } = require('node:util');
const { TerminalUI, clean, clip, cellWidth } = require('../lib/terminal-ui');

function fixture() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = value => { input.isRaw = value; };
  const output = new PassThrough();
  output.columns = 90; output.rows = 32;
  let text = '';
  output.on('data', chunk => { text += chunk; });
  let cancelled = 0;
  const ui = new TerminalUI({
    version: 'test', input, output, motion: false,
    snapshot: () => ({ completed: 0, failed: 0, connections: 4, directory: 'D:\\Downloads' }),
    onCancel: () => { cancelled++; },
  });
  const key = (name, str = '', extra = {}) => ui.handleKey(str, { name, ...extra });
  return { ui, input, output, key, text: () => text, cancelled: () => cancelled };
}

test('terminal text removes control sequences and clips by display cells', () => {
  assert.equal(clean('\x1b[2Jname\x07'), 'name');
  assert.equal(cellWidth('กี่'), 1);
  assert.equal(cellWidth('中文'), 4);
  assert.equal(cellWidth('f'), 1);
  assert.equal(clip('กี่中文abc', 4), 'กี่中');
  assert.equal(cellWidth('📁'), 2);
});

test('home menu navigation resolves the selected real command', async () => {
  const { ui, key } = fixture();
  const selected = ui.home();
  key('down'); key('return');
  assert.equal(await selected, 'history');
});

test('startup splash reveals ZELUX-DL branding and is skippable with the first key', async () => {
  const { ui, key, input, output } = fixture();
  ui.motion = true;
  ui.start();
  assert.equal(ui.state.type, 'boot');
  const bootFrame = ui.buildFrame(90, 32);
  const bootText = bootFrame.lines.flat().map(part => stripVTControlCharacters(part.text)).join(' ');
  assert.match(bootText, /TERMINAL START/);
  key('x', 'x');
  assert.equal(ui.state.type, 'input');
  assert.equal(ui.state.text, 'x');
  await ui.introPromise;
  ui.close();
  assert.equal(input.isRaw, false);
  assert.ok(output);
});

test('reduced motion starts directly on the menu without a splash delay', () => {
  const { ui } = fixture();
  ui.start();
  assert.equal(ui.state.type, 'menu');
  assert.equal(ui.introPromise, undefined);
  ui.close();
});

test('typing at home preserves commands and bracketed multiline paste waits for Enter', async () => {
  const { ui, key } = fixture();
  const result = ui.home();
  key(undefined, '', { sequence: '\x1b[200~' });
  for (const ch of 'https://example.com/a') key(ch, ch);
  key('return', '\r');
  for (const ch of 'https://example.com/b') key(ch, ch);
  key(undefined, '', { sequence: '\x1b[201~' });
  assert.ok(ui.resolve, 'paste must not start downloads without confirmation');
  key('return');
  assert.equal(await result, 'https://example.com/a https://example.com/b');
});

test('input supports editing, Unicode and cancellation without submitting', async () => {
  const { ui, key } = fixture();
  const result = ui.ask('LINK');
  for (const ch of 'กี่ab') key(ch, ch);
  key('left'); key('backspace'); key('end'); key('return');
  assert.equal(await result, 'กี่b');
  const cancelled = ui.ask('LINK', '', 'not submitted');
  key('escape');
  assert.equal(await cancelled, null);
});

test('layout fits every supported viewport including long content and many jobs', () => {
  const { ui } = fixture();
  for (const [columns, rows] of [[40, 12], [60, 26], [75, 28], [90, 32], [160, 50]]) {
    for (const state of [ui.state, { type: 'input', title: 'LINK', hint: 'Help', text: '中文'.repeat(300), cursor: 600 },
      { type: 'page', title: 'HISTORY', lines: ['long title '.repeat(100)], offset: 0 },
      { type: 'operation', title: 'DOWNLOAD' }]) {
      ui.state = state;
      ui.bars = Array.from({ length: 8 }, (_, index) => ({ label: 'file' + index, value: 5, total: 10, payload: {} }));
      ui.logs = ['status '.repeat(100)];
      const frame = ui.buildFrame(columns, rows);
      assert.ok(frame.height < rows);
      frame.lines.forEach(parts => parts.forEach(part => {
        assert.ok(part.x + cellWidth(stripVTControlCharacters(part.text)) <= frame.width);
      }));
    }
  }
});

test('home download destination sits immediately below the menu frame', () => {
  const { ui } = fixture();
  for (const [columns, rows] of [[60, 26], [90, 32], [160, 50]]) {
    ui.state = { type: 'menu', title: 'DOWNLOAD MANAGER', options: require('../lib/terminal-ui').HOME, selected: 0, home: true };
    const frame = ui.buildFrame(columns, rows);
    const visible = Math.min(ui.state.options.length, Math.max(4, frame.height - 19));
    const frameBottom = 11 + visible + 1;
    const saveRow = frameBottom + 1;
    const lineText = y => frame.lines[y].map(part => stripVTControlCharacters(part.text)).join(' ');
    assert.ok(lineText(saveRow).includes('Save to: D:\\Downloads'));
    assert.ok(lineText(frameBottom).includes('╰'), 'the row above the path is the menu bottom border');
    const menuX = Math.floor((frame.width - Math.min(48, frame.width - 12)) / 2);
    const savePart = frame.lines[saveRow].find(part => stripVTControlCharacters(part.text).includes('Save to:'));
    assert.equal(savePart.x, menuX, 'the S in Save aligns to the frame left edge');
    assert.notEqual(saveRow, frame.height - 5, 'the path remains separate from the selected-item description');
  }
});

test('command help renders colored labels in a stable column with readable descriptions', async () => {
  const { ui } = fixture();
  const displayed = ui.page('COMMANDS', [
    'Paste a URL and press Enter.',
    { label: 'settings', description: 'Edit settings with arrow keys', color: 'blue' },
    { label: 'exit', description: 'Exit the application', color: 'red' },
  ]);
  const frame = ui.buildFrame(90, 32);
  const rendered = JSON.stringify(frame);
  const plain = frame.lines.flatMap(parts => parts.map(part => stripVTControlCharacters(part.text))).join(' ');
  assert.match(plain, /settings\s+Edit settings with arrow keys/);
  assert.match(plain, /exit\s+Exit the application/);
  assert.ok(rendered.includes('38;2;59;130;246'), 'settings is highlighted blue');
  assert.ok(rendered.includes('38;2;248;113;113'), 'exit is highlighted red');
  ui.finish(null);
  await displayed;
});

test('progress uses supplied bytes and handles unknown totals without fake percent', async () => {
  const { ui, key, cancelled } = fixture();
  await ui.run('DOWNLOAD', async () => {
    const progress = ui.progress('archive.zip');
    progress.start(100, 0, { downloaded: '0 B', speed: '0 B/s', indeterminate: true });
    progress.update(50, { downloaded: '50 B' });
    let frame = JSON.stringify(ui.buildFrame(90, 32));
    assert.ok(frame.includes('LIVE'));
    assert.ok(!frame.includes('50.0%'));
    progress.update(50, { indeterminate: false });
    frame = JSON.stringify(ui.buildFrame(90, 32));
    assert.ok(frame.includes('50.0%'));
    key('escape');
    assert.equal(cancelled(), 1);
    assert.equal(ui.operation.cancelled, true);
    progress.stop();
  });
  assert.equal(ui.operation, null);
});

test('download progress uses a moving cyan-blue-violet gradient', () => {
  const { ui } = fixture();
  ui.state = { type: 'operation', title: 'DOWNLOAD' };
  ui.bars = [{ label: 'archive.zip', total: 100, value: 80, payload: {}, stopped: false }];
  ui.phase = 0;
  const first = JSON.stringify(ui.buildFrame(90, 32));
  ui.phase = 3;
  const second = JSON.stringify(ui.buildFrame(90, 32));
  assert.ok(first.includes('38;2;6;182;212'), 'gradient starts with cyan');
  assert.ok(first.includes('38;2;59;130;246'), 'gradient includes blue');
  assert.ok(first.includes('38;2;139;92;246'), 'gradient reaches violet');
  assert.notEqual(first, second, 'gradient colors advance while the job is active');
  assert.ok(second.includes('80.0%'), 'real download percentage remains visible');
});

test('unknown file sizes show a moving gradient pulse without an invented percentage', () => {
  const { ui } = fixture();
  ui.state = { type: 'operation', title: 'DOWNLOAD' };
  ui.bars = [{ label: 'stream.mp4', total: 100, value: 35, payload: { indeterminate: true }, stopped: false }];
  ui.phase = 0;
  const first = JSON.stringify(ui.buildFrame(90, 32));
  ui.phase = 2;
  const second = JSON.stringify(ui.buildFrame(90, 32));
  assert.ok(first.includes('LIVE'));
  assert.ok(!first.includes('35.0%'));
  assert.notEqual(first, second);
});

test('concurrent media menus serialize keyboard ownership', async () => {
  const { ui, key } = fixture();
  const first = ui.choose([{ value: 'audio', label: 'Audio' }], 'First');
  const second = ui.choose([{ value: 'video', label: 'Video' }], 'Second');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.state.title, 'First');
  key('return');
  assert.equal(await first, 'audio');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.state.title, 'Second');
  key('return');
  assert.equal(await second, 'video');
});

test('session restores raw mode, cursor and alternate buffer after errors', async () => {
  const { ui, input, output, text } = fixture();
  ui.start();
  assert.equal(input.isRaw, true);
  await assert.rejects(ui.run('FAILURE', async () => { throw new Error('test failure'); }), /test failure/);
  ui.close();
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('keypress'), 0);
  assert.equal(output.listenerCount('resize'), 0);
  assert.ok(text().includes('\x1b[?25h\x1b[?1049l'));
  assert.equal(ui.operation, null);
});
