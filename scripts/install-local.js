// Installs the NSIS bundle produced by `npm run build` over the running app:
// kills the app together with its Node child (the installer cannot replace
// files that are in use), runs the installer silently, then relaunches.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const nsisDir = path.join(projectRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const installedExe = path.join(
  process.env.LOCALAPPDATA || '',
  'windows-mqtt',
  'windows-mqtt.exe'
);

function findInstaller() {
  if (!fs.existsSync(nsisDir)) return null;
  const setups = fs
    .readdirSync(nsisDir)
    .filter((f) => f.endsWith('-setup.exe'))
    .map((f) => path.join(nsisDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return setups[0] || null;
}

if (process.platform !== 'win32') {
  console.error('install-local only runs on Windows.');
  process.exit(1);
}

const installer = findInstaller();
if (!installer) {
  console.error(`No *-setup.exe found in ${nsisDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

console.log(`Stopping windows-mqtt (with its node child)...`);
spawnSync('taskkill', ['/IM', 'windows-mqtt.exe', '/T', '/F'], { stdio: 'inherit' });

console.log(`Installing ${path.basename(installer)} silently...`);
const install = spawnSync(installer, ['/S'], { stdio: 'inherit' });
if (install.status !== 0) {
  console.error(`Installer exited with code ${install.status}`);
  process.exit(install.status ?? 1);
}

if (!fs.existsSync(installedExe)) {
  console.error(`Installed exe not found at ${installedExe}`);
  process.exit(1);
}

console.log(`Launching ${installedExe}`);
// Не inherit: `start` отвязывает процесс, но приложение наследует наши stdout и
// stderr и держит трубу открытой всё время, пока работает. Вызывающая оболочка
// ждёт EOF, а не завершения процесса, поэтому `npm run deploy-local` не
// возвращал управление часами и не печатал ни строчки — и «завершался» ровно в
// тот момент, когда следующий деплой делал taskkill.
spawnSync('cmd', ['/c', 'start', '', installedExe], { stdio: 'ignore' });
