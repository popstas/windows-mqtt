const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const srcTauri = path.join(__dirname, '..', 'src-tauri');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(srcTauri, file), 'utf8'));
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
    '../src/**/*',
    '../node_modules/**/*',
  ];
  for (const glob of required) {
    assert.ok(
      resources.includes(glob),
      `bundle.resources must include ${glob}`
    );
  }
});

// config.yml, commands.yml, and data/ are gitignored and hold the developer's
// real credentials (mqtt.password, obs.password, api keys, etc.). Installers
// before v1.0.0 bundled them directly and shipped those secrets to every
// user — see AGENTS.md's "Never ship secrets in the installer". Precise
// enough not to false-positive on the legitimate config.example.yml /
// commands.example.yml entries (which end in "example.yml", not "config.yml"
// / "commands.yml").
test('base tauri.conf.json never bundles the gitignored credential files', () => {
  const base = readJson('tauri.conf.json');
  const resources = base.bundle && base.bundle.resources;
  assert.ok(Array.isArray(resources), 'bundle.resources must be an array');
  const forbidden = [
    { name: 'config.yml', pattern: /(^|\/)config\.yml$/ },
    { name: 'commands.yml', pattern: /(^|\/)commands\.yml$/ },
    { name: 'data/', pattern: /(^|\/)data(\/|$)/ },
  ];
  for (const glob of resources) {
    for (const { name, pattern } of forbidden) {
      assert.ok(
        !pattern.test(glob),
        `bundle.resources must not include ${name} (found matching entry "${glob}")`
      );
    }
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

test('prepare-frontend copies both pages and the picker filter', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-frontend.js'), 'utf8');
  for (const file of ['index.html', 'sessions.html', 'picker-filter.js', 'session-glyph.js']) {
    assert.ok(src.includes(file), `prepare-frontend.js must copy ${file}`);
  }
});
