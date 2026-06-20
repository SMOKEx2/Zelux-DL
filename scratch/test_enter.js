const readline = require('readline');
let currentView = 'download-done';
function waitForEnter() {
  process.stdout.write("Press enter:");
  const stdin = process.stdin;
  if (!stdin.isTTY || !stdin.setRawMode) {
    let rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: '' });
    let resolved = false;
    rl.on('line', () => {
      if (resolved) return;
      resolved = true;
      rl.close();
      console.log("Got enter (readline)");
      process.exit(0);
    });
    return;
  }
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let resolved = false;
  const onData = (key) => {
    if (resolved) return;
    if (key === '\r' || key === '\n' || key === '\r\n') {
      resolved = true;
      cleanup();
      console.log("Got enter (raw)");
      process.exit(0);
    }
  };
  function cleanup() {
    stdin.removeListener('data', onData);
    if (stdin.setRawMode) stdin.setRawMode(false);
    stdin.pause();
  }
  setTimeout(() => {
    if (!resolved) {
      stdin.on('data', onData);
    }
  }, 100);
}
waitForEnter();
