// Build the native audio-watcher sidecar (../audio-watcher) and copy the
// release binary to ./bin/audio-watcher.exe, where both the headless server
// (src/modules/audio.js) and the bundled Tauri app resolve it from.
//
// Run directly (`npm run build-audio-watcher`) or import it and call build().

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(import.meta.dirname, '..');
const crateDir = path.join(projectRoot, 'audio-watcher');
const exeName = 'audio-watcher.exe';
const builtExe = path.join(crateDir, 'target', 'release', exeName);
const binDir = path.join(projectRoot, 'bin');
const destExe = path.join(binDir, exeName);

function build() {
  if (!fs.existsSync(crateDir)) {
    console.error(`audio-watcher crate not found at ${crateDir}`);
    return false;
  }

  console.log('Building audio-watcher (cargo build --release)...');
  const result = spawnSync('cargo', ['build', '--release'], {
    cwd: crateDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error('cargo build failed for audio-watcher');
    return false;
  }

  if (!fs.existsSync(builtExe)) {
    console.error(`expected binary not found: ${builtExe}`);
    return false;
  }

  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(builtExe, destExe);
  console.log(`audio-watcher -> ${destExe}`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(build() ? 0 : 1);
}

export { build };
