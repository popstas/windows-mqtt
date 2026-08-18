// Кладёт node-часть поверх установленного приложения, минуя сборку.
//
// `deploy-local` каждый раз собирает бинарник и гоняет установщик, а это
// минуты. Между тем интерпретируемая часть — src/ — просто лежит файлами в
// ресурсах установленного приложения: тауриевский bundle.resources кладёт
// `../src/*` в `_up_/src`. Скопировать их и перезапустить приложение — секунды.
//
// Так можно не всё. index.html в файлы не попадает: tauri вшивает
// frontendDist в бинарник. Rust — тем более. Поэтому скрипт сам сверяет
// отметки времени и говорит, когда быстрым путём обойтись не выйдет.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { stopApp } from './stop-app.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const installDir = path.join(process.env.LOCALAPPDATA || '', 'windows-mqtt');
const installedExe = path.join(installDir, 'windows-mqtt.exe');
// tauri раскладывает ресурсы вида `../foo` под `_up_/foo`.
const resourceRoot = path.join(installDir, '_up_');

// Что копируем. Ровно те ресурсы из bundle.resources, которые читаются с диска
// во время работы. node_modules целиком не трогаем — там тысячи файлов и они
// не меняются.
const COPY = [
  'src',
  'bin',
  'assets',
  'config.example.yml',
  'commands.example.yml',
];

// Что быстрым путём не доедет. Если это новее установленного бинарника, значит
// правку он не увидит и нужен полный `deploy-local`.
const NEEDS_BUILD = [
  'src-tauri',
  'index.html',
  // Осознанно не в COPY: package.json несёт "type": "module", и его
  // расхождение с установленной сборкой обязано приводить к полной
  // переустановке, а не к горячей подмене.
  'package.json',
];

function newestMtime(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    // target/ у src-tauri — это сборочный мусор, он новее всего и всегда
    // ложно срабатывал бы.
    if (entry.name === 'target' || entry.name === 'node_modules') continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

if (process.platform !== 'win32') {
  console.error('deploy-fast only runs on Windows.');
  process.exit(1);
}

if (!fs.existsSync(installedExe)) {
  console.error(`Приложение не установлено (${installedExe}). Один раз нужен npm run deploy-local.`);
  process.exit(1);
}

const exeMtime = fs.statSync(installedExe).mtimeMs;
const stale = NEEDS_BUILD.filter((rel) => newestMtime(path.join(projectRoot, rel)) > exeMtime);
if (stale.length) {
  console.error(`Эти правки быстрым путём не доедут: ${stale.join(', ')}.`);
  console.error('index.html вшит в бинарник, Rust тоже — нужен npm run deploy-local.');
  process.exit(1);
}

console.log('Stopping windows-mqtt (with its node child)...');
stopApp(resourceRoot);

let copied = 0;
for (const rel of COPY) {
  const from = path.join(projectRoot, rel);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(resourceRoot, rel), { recursive: true, force: true, dereference: true });
  copied += 1;
  console.log(`  ${rel}`);
}
console.log(`Скопировано ресурсов: ${copied}`);

console.log(`Launching ${installedExe}`);
// stdio: 'ignore', а не 'inherit': приложение наследовало бы наши stdout и
// stderr и держало трубу открытой всё время работы, а вызывающая оболочка
// ждёт EOF, а не завершения процесса. Ровно из-за этого висел deploy-local.
spawnSync('cmd', ['/c', 'start', '', installedExe], { stdio: 'ignore' });
