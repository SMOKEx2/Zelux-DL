let arg = 'zelux://https//ash-speed.hetzner.com/100MB.bin';
let m = arg.match(/^zelux:\/\/(.+)$/i);
let c = m[1];
c = c.replace(/^(https?)\/\//, '$1://');
console.log(c);
try { let u = new URL(c); console.log('VALID:', u.href); } catch(e) { console.log('INVALID'); }
