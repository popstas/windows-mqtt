var fs = require('fs');
fs.mkdirSync('frontend', { recursive: true });
fs.copyFileSync('index.html', 'frontend/index.html');
