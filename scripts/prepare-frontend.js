var fs = require('fs');
fs.mkdirSync('frontend', { recursive: true });
fs.copyFileSync('index.html', 'frontend/index.html');
fs.copyFileSync('sessions.html', 'frontend/sessions.html');
fs.copyFileSync('frontend-src/picker-filter.js', 'frontend/picker-filter.js');
