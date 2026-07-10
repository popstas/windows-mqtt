const { spawnSync } = require('child_process');
const path = require('path');
const { prepareDeps, restoreDeps } = require('./deps-bundle');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tauri-wrapper.js <dev|build>');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

function runTauri() {
  if (process.platform === 'win32') {
    const cmdPath = path.join(projectRoot, 'scripts', 'tauri-wrapper.cmd');
    const result = spawnSync('cmd', ['/c', cmdPath, ...args], {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    return result.status ?? 1;
  }
  const result = spawnSync('npx', ['tauri', ...args], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  return result.status ?? 1;
}

// Only `build` bundles node_modules and needs the windows11-manager junction
// replaced with a real copy; `dev` must keep the live link intact.
const isBuild = args[0] === 'build';
let status = 1;
if (isBuild) prepareDeps();
try {
  status = runTauri();
} finally {
  if (isBuild) restoreDeps();
}
process.exit(status);
