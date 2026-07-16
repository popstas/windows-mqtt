// Materialize the `windows11-manager` dependency for bundling.
//
// In dev, `node_modules/windows11-manager` is a junction to the sibling repo
// (`file:../windows11-manager`). Tauri's resource globber would either follow it
// into the sibling's ~5.9 GB tree or copy a reparse point that breaks on other
// machines. So for `build` we replace the junction with a pruned REAL copy
// containing only the files needed at runtime, then restore the junction
// afterwards so the dev live-link is preserved.
//
// Usage: require() and call prepareDeps()/restoreDeps(), or run directly:
//   node scripts/deps-bundle.js prepare | restore

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const nmDir = path.join(projectRoot, 'node_modules');
const linkPath = path.join(nmDir, 'windows11-manager');
// Kept OUTSIDE node_modules so it is not swept into the bundle, and records the
// real source dir so restore (or an interrupted rerun) can rebuild the junction.
const statePath = path.join(projectRoot, '.w11m-bundle-state');

// Top-level entries copied verbatim from the windows11-manager package.
const W11M_INCLUDE = [
  'package.json',
  'config.cjs',
  'config.example.cjs',
  'VirtualDesktop11.exe', // shelled out by src/virtual-desktop.js
  'src', // includes hooks_x64.dll, x64desktopacessor.dll
];

// windows11-manager under-declares its deps (e.g. node-window-manager is
// imported but absent from package.json) and vendors a native addon via a
// symlink, so we copy its whole node_modules (dereferencing symlinks) rather
// than trying to reconstruct the closure by hand. These dev-only packages are
// skipped to keep the bundle small; none are required at runtime (koffi is
// only referenced by node-gyp-build's loader, not imported).
const W11M_NM_DENYLIST = new Set([
  'typescript', 'koffi', 'esbuild', '@esbuild', 'rollup', '@rollup',
  'eslint', '@eslint', 'vite', 'vitest', '@vitest', '@types',
  'node-gyp', 'tsx', 'prettier', '.bin', '.cache', '.package-lock.json',
]);

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function prepareDeps() {
  let source;
  if (isLink(linkPath)) {
    source = fs.realpathSync(linkPath);
  } else if (fs.existsSync(statePath)) {
    // A previous build was interrupted before restore; refresh from the record.
    source = fs.readFileSync(statePath, 'utf8').trim();
  } else {
    console.log('[deps-bundle] windows11-manager is not a junction; assuming a real install, skipping.');
    return;
  }

  if (!fs.existsSync(source)) {
    throw new Error(`[deps-bundle] windows11-manager source not found: ${source}. Run npm install.`);
  }

  fs.writeFileSync(statePath, source);
  if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(linkPath, { recursive: true });

  for (const rel of W11M_INCLUDE) {
    const from = path.join(source, rel);
    if (!fs.existsSync(from)) {
      console.warn(`[deps-bundle] skipped missing entry: ${rel}`);
      continue;
    }
    copyRecursive(from, path.join(linkPath, rel));
  }

  // Copy its node_modules minus dev-only packages (symlinks dereferenced).
  const srcNM = path.join(source, 'node_modules');
  if (fs.existsSync(srcNM)) {
    const destNM = path.join(linkPath, 'node_modules');
    for (const entry of fs.readdirSync(srcNM)) {
      if (W11M_NM_DENYLIST.has(entry)) continue;
      copyRecursive(path.join(srcNM, entry), path.join(destNM, entry));
    }
  }
  console.log(`[deps-bundle] materialized windows11-manager (runtime deps) from ${source}`);
}

function restoreDeps() {
  if (!fs.existsSync(statePath)) return;
  const source = fs.readFileSync(statePath, 'utf8').trim();
  if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(source, linkPath, 'junction');
  fs.rmSync(statePath, { force: true });
  console.log(`[deps-bundle] restored windows11-manager junction -> ${source}`);
}

module.exports = { prepareDeps, restoreDeps };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'prepare') prepareDeps();
  else if (cmd === 'restore') restoreDeps();
  else {
    console.error('Usage: node scripts/deps-bundle.js prepare|restore');
    process.exit(1);
  }
}
