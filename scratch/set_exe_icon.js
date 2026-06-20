const fs = require('fs');
const resedit = require('resedit');
const path = require('path');

async function main() {
  try {
    const rootDir = path.join(__dirname, '..');
    const icoPath = path.join(rootDir, 'dist', 'icon.ico');
    const exePath = path.join(rootDir, 'dist', 'ZELUX-DL.exe');

    console.log('Setting EXE icon...');
    
    // Read the EXE and Icon files
    const data = fs.readFileSync(exePath);
    const exe = resedit.NtExecutable.from(data);
    const res = resedit.NtExecutableResource.from(exe);
    
    const iconFile = resedit.Data.IconFile.from(fs.readFileSync(icoPath));
    
    // Replace the icon resource
    resedit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        1,
        1033,
        iconFile.icons.map(item => item.data)
    );
    
    // Output and save
    res.outputResource(exe);
    const newBuffer = Buffer.from(exe.generate());
    fs.writeFileSync(exePath, newBuffer);

    console.log('Done!');
  } catch (err) {
    console.error(err);
  }
}

main();
