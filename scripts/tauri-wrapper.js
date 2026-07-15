const { spawnSync } = require('child_process');
const path = require('path');
const { prepareDeps, restoreDeps } = require('./deps-bundle');
const { build: buildAudioWatcher } = require('./build-audio-watcher');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tauri-wrapper.js <dev|build>');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

// The full `resources` list (incl. `../node_modules/**/*`) lives in the base
// tauri.conf.json so a plain `npx tauri build` still produces a complete bundle.
// For `dev` we overlay tauri.dev.conf.json, whose empty `resources` array
// REPLACES the base list (Tauri v2 `--config` merge replaces arrays rather than
// appending). That keeps `dev` from making Tauri's build script walk the live
// `windows11-manager` junction (a ~5.9 GB sibling repo, incl. its `.git`) — a
// walk that is slow and intermittently fails when a background git op locks an
// object. Path is relative to cwd (projectRoot) to avoid spaces.
const isBuild = args[0] === 'build';
const isDev = args[0] === 'dev';
if (isDev) {
  args.push('--config', 'src-tauri/tauri.dev.conf.json');
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
if (isBuild) {
  // Bundle a fresh audio-watcher sidecar into ../bin (a bundle resource).
  if (!buildAudioWatcher()) process.exit(1);
}
try {
  // prepareDeps() is destructive (replaces the windows11-manager junction with
  // a real copy) and can throw mid-copy, so it lives inside the try to guarantee
  // restoreDeps() runs in `finally` and puts the dev junction back. restoreDeps
  // is a no-op unless prepareDeps got far enough to record its state file.
  if (isBuild) prepareDeps();
  status = runTauri();
} finally {
  if (isBuild) restoreDeps();
}
process.exit(status);
