const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');

const repoRoot = path.join(__dirname, '..');
const srcTauri = path.join(repoRoot, 'src-tauri');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(srcTauri, file), 'utf8'));
}

// Resource entries whose expansion is *expected* to include gitignored files:
// node_modules holds installed dependencies and bin/ holds built binaries
// (audio-watcher.exe), neither committed to git but both required at runtime.
// See AGENTS.md "Never ship secrets in the installer" / "Known and accepted".
const RESOURCE_GLOBS_ALLOWED_TO_BE_GITIGNORED = ['../node_modules/**/*', '../bin/*'];

// Expands a bundle.resources entry (relative to src-tauri) to the paths it
// actually matches on disk, relative to the repo root. Mirrors tauri-utils'
// own resource resolution (crates/tauri-utils/src/resources.rs) closely
// enough for this check: entries without a `*` are exact files; entries with
// a `*` are expanded with fs.globSync and then filtered down to files only,
// because tauri's glob iterator *skips* any directory a glob pattern matches
// (see `next_current_path`: hitting a directory mid-glob-iteration recurses
// into `self.next()` without emitting a resource for it or walking it) —
// only its individually-matched file entries end up in the bundle.
function expandResourceGlob(glob) {
  const rel = glob.replace(/^\.\.\//, '');
  if (!glob.includes('*')) {
    return fs.existsSync(path.join(repoRoot, rel)) ? [rel] : [];
  }
  return fs.globSync(rel, { cwd: repoRoot })
    .filter(p => fs.statSync(path.join(repoRoot, p)).isFile());
}

// Asks git which of the given (repo-root-relative) paths are gitignored,
// using git's own ignore rules rather than a hardcoded list of names.
function gitIgnoredOf(paths) {
  if (paths.length === 0) return [];
  let stdout;
  try {
    stdout = execFileSync('git', ['check-ignore', '--stdin', '-v'], {
      cwd: repoRoot,
      input: paths.join('\n') + '\n',
      encoding: 'utf8',
    });
  } catch (e) {
    // Exit code 1 means none of the fed paths are ignored.
    if (e.status === 1) return [];
    throw e;
  }
  return stdout.split('\n').filter(Boolean);
}

// The full resource list must live in the base config so a plain
// `npx tauri build` (without the wrapper) still bundles the Node payload.
test('base tauri.conf.json bundles the full resource list', () => {
  const base = readJson('tauri.conf.json');
  const resources = base.bundle && base.bundle.resources;
  assert.ok(Array.isArray(resources), 'bundle.resources must be an array');
  const required = [
    '../config.example.yml',
    '../commands.example.yml',
    '../bin/*',
    '../src/*',
    '../src/modules/**/*',
    '../src/picker/**/*',
    '../node_modules/**/*',
  ];
  for (const glob of required) {
    assert.ok(
      resources.includes(glob),
      `bundle.resources must include ${glob}`
    );
  }
});

// config.yml, commands.yml, data/, and (as of the src/daemon leak) any other
// gitignored path are never supposed to reach the installed bundle — see
// AGENTS.md's "Never ship secrets in the installer". The previous version of
// this test only string-matched three hardcoded filenames against the raw
// config, which gave false assurance: it never actually looked at what the
// globs expand to on disk, so `../src/**/*` sweeping in the gitignored
// `src/daemon/` (a local service-wrapper dir containing logs with absolute
// developer paths) went uncaught. This resolves every resource entry to the
// real files it matches and asks git — not a hardcoded name list — whether
// any of them are ignored, so a future wildcard entry can't slip past it
// either.
test('bundle.resources never expands to a gitignored path outside the known node_modules/bin exceptions', () => {
  const base = readJson('tauri.conf.json');
  const resources = base.bundle && base.bundle.resources;
  assert.ok(Array.isArray(resources), 'bundle.resources must be an array');

  const offenders = [];
  for (const glob of resources) {
    if (RESOURCE_GLOBS_ALLOWED_TO_BE_GITIGNORED.includes(glob)) continue;
    const expanded = expandResourceGlob(glob);
    const ignored = gitIgnoredOf(expanded);
    if (ignored.length > 0) offenders.push(`  ${glob} ->\n    ${ignored.join('\n    ')}`);
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `bundle.resources must not ship gitignored files:\n${offenders.join('\n')}`
  );
});

// The enumeration in bundle.resources (`../src/*` + one `../src/<subdir>/**/*`
// per subdirectory) is correct today but brittle: it pins the *current* three
// subdirectories (`daemon`, `modules`, `picker`) by nothing more than someone
// having remembered to add a line. A future `src/newthing/` would ship no
// files and fail silently until the installed app throws MODULE_NOT_FOUND at
// runtime. This checks the property that actually matters — every file under
// every non-gitignored src/ subdirectory is matched by *some* resources glob
// — derived from git's own ignore rules (so `daemon` drops out because git
// says it's ignored, not because a test hardcodes its name), rather than
// pinning the glob strings themselves.
test('every non-gitignored subdirectory of src/ is fully covered by bundle.resources', () => {
  const base = readJson('tauri.conf.json');
  const resources = base.bundle && base.bundle.resources;
  assert.ok(Array.isArray(resources), 'bundle.resources must be an array');

  const srcDir = path.join(repoRoot, 'src');
  const subdirNames = fs.readdirSync(srcDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const relDirs = subdirNames.map(name => `src/${name}`);
  // gitIgnoredOf returns raw `git check-ignore -v` lines
  // (`<source>:<line>:<pattern>\t<path>`), not bare paths — pull the path
  // back out (the part after the last tab) to compare against relDirs.
  const ignored = new Set(gitIgnoredOf(relDirs).map(line => line.slice(line.lastIndexOf('\t') + 1)));
  const trackedDirNames = subdirNames.filter(name => !ignored.has(`src/${name}`));
  assert.ok(
    trackedDirNames.length > 0,
    'expected at least one non-gitignored src/ subdirectory to exist (sanity check)'
  );

  const coveredFiles = new Set(resources.flatMap(expandResourceGlob));

  for (const name of trackedDirNames) {
    const filesInDir = fs.globSync(`src/${name}/**/*`, { cwd: repoRoot })
      .filter(p => fs.statSync(path.join(repoRoot, p)).isFile());
    const uncovered = filesInDir.filter(f => !coveredFiles.has(f));
    assert.deepStrictEqual(
      uncovered,
      [],
      `src/${name}/ has files bundle.resources does not match (would MODULE_NOT_FOUND at ` +
      `runtime in the installed app):\n  ${uncovered.join('\n  ')}`
    );
  }
});

// The dev overlay empties resources (RFC 7396 merge replaces arrays), keeping
// `dev` out of the slow node_modules/junction walk.
test('dev overlay empties bundle.resources', () => {
  const dev = readJson('tauri.dev.conf.json');
  assert.ok(dev.bundle, 'dev overlay must have a bundle section');
  assert.deepStrictEqual(dev.bundle.resources, []);
});

// NSIS only overwrites files present in the new bundle, so files dropped from
// it survive upgrades and can shadow real config at runtime. The PREINSTALL
// hook wipes the payload dir to make every install a clean install.
test('nsis installer hook is wired up and wipes the app payload dir', () => {
  const base = readJson('tauri.conf.json');
  const hookPath =
    base.bundle &&
    base.bundle.windows &&
    base.bundle.windows.nsis &&
    base.bundle.windows.nsis.installerHooks;
  assert.equal(hookPath, './nsis-hooks.nsh');

  const hookFile = path.join(srcTauri, 'nsis-hooks.nsh');
  assert.ok(fs.existsSync(hookFile), 'installerHooks must point at a real file');

  const hook = fs.readFileSync(hookFile, 'utf8');
  assert.match(hook, /!macro NSIS_HOOK_PREINSTALL/);
  assert.match(hook, /RMDir \/r "\$INSTDIR\\_up_"/);
});

// The old build-only overlay is gone; builds are correct-by-default.
test('legacy tauri.bundle.conf.json is removed', () => {
  assert.ok(
    !fs.existsSync(path.join(srcTauri, 'tauri.bundle.conf.json')),
    'tauri.bundle.conf.json should no longer exist'
  );
});

// A plain `src.includes('sessions.html')` would still pass if that copy line
// were commented out, or if the file were copied to the wrong destination
// (e.g. a stray edit sending it to frontend/index.html). Assert the actual
// (source, destination) pairs the script passes to copyFileSync instead.
test('prepare-frontend copies both pages and the picker filter to the right destinations', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'prepare-frontend.js'), 'utf8');
  const calls = [...src.matchAll(/copyFileSync\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)]
    .map(m => ({ from: m[1], to: m[2] }));

  const required = [
    { from: 'index.html', to: 'frontend/index.html' },
    { from: 'sessions.html', to: 'frontend/sessions.html' },
    { from: 'frontend-src/picker-filter.js', to: 'frontend/picker-filter.js' },
    { from: 'frontend-src/session-glyph.js', to: 'frontend/session-glyph.js' },
    { from: 'frontend-src/picker-snapshots.js', to: 'frontend/picker-snapshots.js' },
  ];
  for (const pair of required) {
    assert.ok(
      calls.some(c => c.from === pair.from && c.to === pair.to),
      `prepare-frontend.js must copyFileSync('${pair.from}', '${pair.to}')`
    );
  }
});

// The picker hotkey default is duplicated across two languages: main.rs'
// DEFAULT_PICKER_HOTKEY (used when picker.hotkey is absent from config.yml)
// and config.example.yml's documented default. Nothing else catches these
// drifting apart.
test('DEFAULT_PICKER_HOTKEY in main.rs matches config.example.yml picker.hotkey', () => {
  const mainRs = fs.readFileSync(path.join(srcTauri, 'src', 'main.rs'), 'utf8');
  const m = mainRs.match(/const\s+DEFAULT_PICKER_HOTKEY\s*:\s*&str\s*=\s*"([^"]+)"/);
  assert.ok(m, 'could not find `const DEFAULT_PICKER_HOTKEY: &str = "..."` in main.rs');
  const rustDefault = m[1];

  const config = yaml.load(fs.readFileSync(path.join(repoRoot, 'config.example.yml'), 'utf8'));
  const configHotkey = config && config.picker && config.picker.hotkey;

  assert.strictEqual(
    configHotkey,
    rustDefault,
    'config.example.yml picker.hotkey must match DEFAULT_PICKER_HOTKEY in main.rs'
  );
});

test('config.example.yml no longer defines claudeProjects (moved to windows11-manager)', () => {
  const config = yaml.load(fs.readFileSync(path.join(repoRoot, 'config.example.yml'), 'utf8'));
  assert.equal(config.claudeProjects, undefined);
});
