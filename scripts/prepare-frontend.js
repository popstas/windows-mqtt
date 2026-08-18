import fs from 'fs';
fs.mkdirSync('frontend', { recursive: true });
fs.copyFileSync('index.html', 'frontend/index.html');
fs.copyFileSync('about.html', 'frontend/about.html');
