const https = require('https');
https.get('https://master.streamhls.com/p2p/f79bda4b2edf9419e6621477c90c3264', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://www.037hddmovie.com/'
  }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const regex = /https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g;
    const matches = data.match(regex);
    console.log("Matches:", matches);
    console.log("Full data preview:", data.substring(2000, 4000));
  });
}).on('error', console.error);
