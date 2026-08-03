var fs = require('fs');
fs.mkdirSync('frontend', { recursive: true });
fs.copyFileSync('index.html', 'frontend/index.html');
fs.copyFileSync('sessions.html', 'frontend/sessions.html');
fs.copyFileSync('frontend-src/picker-filter.js', 'frontend/picker-filter.js');
fs.copyFileSync('frontend-src/session-glyph.js', 'frontend/session-glyph.js');
fs.copyFileSync('frontend-src/session-info.js', 'frontend/session-info.js');
fs.copyFileSync('frontend-src/picker-snapshots.js', 'frontend/picker-snapshots.js');
