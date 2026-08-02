const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setSessionsSortInYaml, readSessionsSortFromConfig, readHaSessionsSort, readShowPathsFromConfig, setShowPathsInYaml, readShowEventFromConfig, setShowEventInYaml } = require('../src/picker/sessions-sort-config');

test('setSessionsSortInYaml replaces an existing sessionsSort line', () => {
  const src =
    'modules:\n' +
    '  windows:\n' +
    '    claudeWt: true\n' +
    '    sessionsSort: cost\n' +
    '    placeWindowOnOpen: true\n';
  const out = setSessionsSortInYaml(src, 'oldest');
  assert.match(out, /^\s*sessionsSort:\s*oldest\s*$/m);
  assert.match(out, /claudeWt: true/);
  assert.match(out, /placeWindowOnOpen: true/);
  assert.doesNotMatch(out, /sessionsSort:\s*cost/);
});

test('setSessionsSortInYaml inserts under windows when the key is missing', () => {
  const src =
    'modules:\n' +
    '  windows:\n' +
    '    claudeWt: true\n' +
    '    placeWindowOnOpen: true\n';
  const out = setSessionsSortInYaml(src, 'name');
  assert.match(out, /windows:\n\s+sessionsSort: name\n\s+claudeWt: true/);
});

test('setSessionsSortInYaml keeps comments around the windows block', () => {
  const src =
    'modules:\n' +
    '  windows:\n' +
    '    # start the watcher\n' +
    '    claudeWt: true\n';
  const out = setSessionsSortInYaml(src, 'recent');
  assert.match(out, /# start the watcher/);
  assert.match(out, /sessionsSort: recent/);
});

test('readSessionsSortFromConfig reads module opts or full config', () => {
  assert.strictEqual(readSessionsSortFromConfig({ sessionsSort: 'name' }), 'name');
  assert.strictEqual(readSessionsSortFromConfig({ modules: { windows: { sessionsSort: 'recent' } } }), 'recent');
  assert.strictEqual(readSessionsSortFromConfig(null), 'cost');
});

test('readHaSessionsSort prefers homeassistant.sessionsSort then falls back', () => {
  assert.strictEqual(
    readHaSessionsSort({ sessionsSort: 'recent', homeassistant: { sessionsSort: 'cost' } }),
    'cost',
  );
  assert.strictEqual(
    readHaSessionsSort({ sessionsSort: 'recent', homeassistant: {} }),
    'recent',
  );
  assert.strictEqual(
    readHaSessionsSort({ modules: { windows: { sessionsSort: 'name', homeassistant: { sessionsSort: 'oldest' } } } }),
    'oldest',
  );
  assert.strictEqual(readHaSessionsSort(null), 'cost');
});

test('setSessionsSortInYaml round-trips through a real file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-sort-'));
  const file = path.join(dir, 'config.yml');
  try {
    fs.writeFileSync(file, 'modules:\n  windows:\n    claudeWt: true\n');
    const { writeSessionsSortFile } = require('../src/picker/sessions-sort-config');
    writeSessionsSortFile(file, 'newest');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /sessionsSort: newest/);
    assert.match(text, /claudeWt: true/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readShowPathsFromConfig defaults to true', () => {
  assert.strictEqual(readShowPathsFromConfig(null), true);
  assert.strictEqual(readShowPathsFromConfig({}), true);
  assert.strictEqual(readShowPathsFromConfig({ showPaths: false }), false);
  assert.strictEqual(readShowPathsFromConfig({ modules: { windows: { showPaths: false } } }), false);
  assert.strictEqual(readShowPathsFromConfig({ showPaths: true }), true);
});

test('setShowPathsInYaml replaces or inserts under windows', () => {
  const withKey =
    'modules:\n' +
    '  windows:\n' +
    '    sessionsSort: cost\n' +
    '    showPaths: true\n';
  assert.match(setShowPathsInYaml(withKey, false), /^\s*showPaths:\s*false\s*$/m);
  assert.doesNotMatch(setShowPathsInYaml(withKey, false), /showPaths:\s*true/);

  const missing =
    'modules:\n' +
    '  windows:\n' +
    '    sessionsSort: cost\n';
  assert.match(setShowPathsInYaml(missing, false), /windows:\n\s+showPaths: false\n\s+sessionsSort: cost/);
});

test('readShowEventFromConfig defaults to true', () => {
  assert.strictEqual(readShowEventFromConfig(null), true);
  assert.strictEqual(readShowEventFromConfig({ showEvent: false }), false);
  assert.strictEqual(readShowEventFromConfig({ modules: { windows: { showEvent: false } } }), false);
});

test('setShowEventInYaml replaces or inserts under windows', () => {
  const withKey =
    'modules:\n' +
    '  windows:\n' +
    '    showEvent: true\n';
  assert.match(setShowEventInYaml(withKey, false), /^\s*showEvent:\s*false\s*$/m);

  const missing =
    'modules:\n' +
    '  windows:\n' +
    '    sessionsSort: cost\n';
  assert.match(setShowEventInYaml(missing, false), /windows:\n\s+showEvent: false\n\s+sessionsSort: cost/);
});
