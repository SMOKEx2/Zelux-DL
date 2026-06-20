const fs = require('fs');
const rcedit = require('rcedit').rcedit;
const path = require('path');

async function main() {
  try {
    const rootDir = path.join(__dirname, '..');
    const icoPath = path.join(rootDir, 'dist', 'icon.ico');
    const exePath = path.join(rootDir, 'dist', 'ZELUX-DL.exe');

    console.log('Setting EXE icon...');
    await rcedit(exePath, {
      icon: icoPath
    });

    console.log('Done!');
  } catch (err) {
    console.error(err);
  }
}

main();
