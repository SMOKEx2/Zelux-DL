const cliProgress = require('cli-progress');
const chalk = require('chalk');

const barSize = 33;
let isFirstFrame = true;

function rainbowBar(filled, empty) {
  return '█'.repeat(filled) + '░'.repeat(empty);
}

const bar = new cliProgress.SingleBar({
  format: (options, params, payload) => {
    const filled = Math.round(params.progress * barSize);
    const empty = barSize - filled;
    const rb = rainbowBar(filled, empty);
    const pct = (params.progress * 100).toFixed(1) + '%';
    const spd = payload.speed || '0 B/s';

    const line1 = `      ${rb} ${pct}`;
    const line2 = `      ${spd} │ ${payload.downloaded || '0 B'}/${payload.total || '??'} │ ${payload.eta_formatted || '--:--'}`;

    if (isFirstFrame) {
      isFirstFrame = false;
      return `${line1}\n${line2}`;
    } else {
      // Test the current implementation (1A) vs proposed (2A)
      return `\x1b[1A\r${line1}\x1b[K\n${line2}\x1b[K`;
    }
  },
  barsize: barSize,
  hideCursor: true,
  clearOnComplete: false,
  stopOnComplete: false,
  forceRedraw: true,
});

bar.start(100, 0, { speed: '0 B/s', downloaded: '0 B', total: '100 B', eta_formatted: '--:--' });

let progress = 0;
const interval = setInterval(() => {
  progress += 10;
  bar.update(progress, { speed: '10 B/s', downloaded: `${progress} B` });
  if (progress >= 100) {
    clearInterval(interval);
    bar.stop();
  }
}, 100);
