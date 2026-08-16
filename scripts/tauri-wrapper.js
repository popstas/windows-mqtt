const { spawnSync } = require('child_process');
const path = require('path');
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
// appending): `dev` runs from the working tree and reads node_modules in place,
// so copying its thousands of files into the bundle would only cost time.
// Path is relative to cwd (projectRoot) to avoid spaces.
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

if (isBuild && process.platform !== 'win32') {
  // Bundle a fresh audio-watcher sidecar into ../bin (a bundle resource).
  // On Windows this cargo build needs the MSVC toolchain (kernel32.lib etc.) on
  // PATH, which only tauri-wrapper.cmd provides via vcvars64.bat — so there the
  // sidecar is built *inside* the .cmd, after vcvars, rather than here.
  if (!buildAudioWatcher()) process.exit(1);
}
process.exit(runTauri());
