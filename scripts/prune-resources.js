// Пишет overlay-конфиг src-tauri/tauri.build.conf.json, в котором огульный
// `../node_modules/**/*` из базового bundle.resources заменён на один glob на
// каждый production-пакет. Tauri v2 не умеет исключающие globs, поэтому
// devDependencies (@tauri-apps/cli, typescript, @types/*) иначе уезжают в
// установщик целиком — десятки мегабайт, которые в рантайме никто не читает.
//
// Список пакетов берётся из package-lock.json (флаг `dev: true`), а не из
// `npm ls`: без запуска npm, детерминированно и проверяемо тестом.
//
// Run directly or import it and call writeOverlay().

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(import.meta.dirname, '..');
const NODE_MODULES_GLOB = '../node_modules/**/*';
const OVERLAY_PATH = 'src-tauri/tauri.build.conf.json';

// Только верхний уровень node_modules: вложенные node_modules/a/node_modules/b
// покрывает `**/*` родителя. `optional` и `devOptional` остаются — это
// платформенные и опциональные рантайм-зависимости; не установленные на этой
// машине отсекает isInstalled (glob без совпадений роняет сборку Tauri).
function prodPackages(lock, isInstalled) {
  const names = [];
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    if (!match || meta.dev) continue;
    if (isInstalled(match[1])) names.push(match[1]);
  }
  return names.sort();
}

function pruneResources(baseResources, packages) {
  const at = baseResources.indexOf(NODE_MODULES_GLOB);
  if (at === -1) {
    throw new Error(`bundle.resources has no ${NODE_MODULES_GLOB} entry to prune`);
  }
  if (packages.length === 0) {
    throw new Error('no production packages found — is node_modules installed?');
  }
  return [
    ...baseResources.slice(0, at),
    ...packages.map(name => `../node_modules/${name}/**/*`),
    ...baseResources.slice(at + 1),
  ];
}

function writeOverlay() {
  const readJson = rel => JSON.parse(fs.readFileSync(path.join(projectRoot, rel), 'utf8'));
  const isInstalled = name =>
    fs.existsSync(path.join(projectRoot, 'node_modules', name, 'package.json'));

  const base = readJson('src-tauri/tauri.conf.json').bundle.resources;
  const packages = prodPackages(readJson('package-lock.json'), isInstalled);
  const overlay = { bundle: { resources: pruneResources(base, packages) } };
  fs.writeFileSync(path.join(projectRoot, OVERLAY_PATH), JSON.stringify(overlay, null, 2) + '\n');
  console.log(`${OVERLAY_PATH}: ${packages.length} production packages`);
  return OVERLAY_PATH;
}

// См. build-audio-watcher.js: argv[1] надо резолвить через realpath.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  writeOverlay();
}

export { prodPackages, pruneResources, writeOverlay, NODE_MODULES_GLOB, OVERLAY_PATH };
