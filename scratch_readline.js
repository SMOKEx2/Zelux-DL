const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'ZELUX-DL ❯ '
});

rl.prompt();

rl.on('line', (line) => {
  if (!line.trim()) {
    process.stdout.write('\x1b[1A\r\x1b[K');
    rl.prompt();
    return;
  }
  if (line.trim() === 'q') process.exit(0);
  console.log('You said:', line);
  rl.prompt();
});
