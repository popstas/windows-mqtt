const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tauri-wrapper.js <dev|build>');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

if (process.platform === 'win32') {
  const cmdPath = path.join(projectRoot, 'scripts', 'tauri-wrapper.cmd');
  const result = spawnSync('cmd', ['/c', cmdPath, ...args], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  process.exit(result.status ?? 1);
} else {
  const result = spawnSync('npx', ['tauri', ...args], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  process.exit(result.status ?? 1);
}
