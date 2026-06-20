const readline = require('readline');
const stdin = process.stdin;

function test() {
  console.log("Starting raw mode listener...");
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const onKey = (key) => {
    if (key === '\r') {
      console.log("Got enter in raw mode. Stopping listener...");
      stdin.removeListener('data', onKey);
      
      // THIS IS THE BUGGY TOGGLE
      if (stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause();
      
      setTimeout(startReadline, 500);
    }
  };
  stdin.on('data', onKey);
}

function startReadline() {
  console.log("Starting readline interface...");
  const rl = readline.createInterface({
    input: stdin,
    output: process.stdout
  });
  rl.on('line', (line) => {
    console.log("Got enter in readline! Exiting.");
    process.exit(0);
  });
}

test();
