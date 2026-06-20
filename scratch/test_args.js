const fs = require('fs');
fs.writeFileSync('test_args.log', JSON.stringify(process.argv));
