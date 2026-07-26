const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const names = ['ZELUX-DL.exe', 'ZELUX-DL-linux'];
const lines = names.map(name => {
  const filePath = path.join(distDir, name);
  if (!fs.existsSync(filePath)) throw new Error(`Missing build artifact: ${name}`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return `${hash}  ${name}`;
});

fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
console.log(lines.join('\n'));
