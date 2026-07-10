const { spawnSync } = require('child_process');
const path = require('path');
const { prepareDeps, restoreDeps } = require('./deps-bundle');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tauri-wrapper.js <dev|build>');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

// Bundling the runtime deps (`../node_modules/**/*`) lives in a build-only
// config overlay, NOT the base tauri.conf.json. Keeping it out of the base means
// `dev` doesn't make Tauri's build script walk the live `windows11-manager`
// junction (a ~5.9 GB sibling repo, incl. its `.git`) — a walk that is slow and
// intermittently fails when a background git op locks an object. The overlay is
// applied only for `build`, after prepareDeps() has replaced the junction with a
// pruned, VCS-free copy. Path is relative to cwd (projectRoot) to avoid spaces.
const isBuild = args[0] === 'build';
if (isBuild) {
  args.push('--config', 'src-tauri/tauri.bundle.conf.json');
}

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

// `build` also needs the windows11-manager junction replaced with a real copy
// (see prepareDeps); `dev` must keep the live link intact.
let status = 1;
if (isBuild) prepareDeps();
try {
  status = runTauri();
} finally {
  if (isBuild) restoreDeps();
}
process.exit(status);
