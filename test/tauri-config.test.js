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

// The dev overlay empties resources (RFC 7396 merge replaces arrays), keeping
// `dev` out of the slow node_modules/junction walk.
test('dev overlay empties bundle.resources', () => {
  const dev = readJson('tauri.dev.conf.json');
  assert.ok(dev.bundle, 'dev overlay must have a bundle section');
  assert.deepStrictEqual(dev.bundle.resources, []);
});

// The old build-only overlay is gone; builds are correct-by-default.
test('legacy tauri.bundle.conf.json is removed', () => {
  assert.ok(
    !fs.existsSync(path.join(srcTauri, 'tauri.bundle.conf.json')),
    'tauri.bundle.conf.json should no longer exist'
  );
});
