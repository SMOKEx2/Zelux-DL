const fs = require('fs');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico');
const rcedit = require('rcedit');
const path = require('path');

async function main() {
  try {
    const rootDir = path.join(__dirname, '..');
    const iconPath = path.join(rootDir, 'zelux-extension', 'icon.png');
    const roundPngPath = path.join(__dirname, 'icon_round.png');
    const icoPath = path.join(rootDir, 'dist', 'icon.ico');
    const exePath = path.join(rootDir, 'dist', 'ZELUX-DL.exe');

    console.log('Loading image...');
    const image = await Jimp.read(iconPath);
    
    console.log('Cropping to circle...');
    image.circle();
    
    console.log('Saving round PNG...');
    await image.write(roundPngPath);

    console.log('Converting to ICO...');
    const buf = await pngToIco.default(roundPngPath);
    fs.writeFileSync(icoPath, buf);

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
