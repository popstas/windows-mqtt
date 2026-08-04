const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setSessionsSortInYaml, readSessionsSortFromConfig, readHaSessionsSort, PICKER_TOGGLES, isPickerToggle, readToggleFromConfig, readTogglesFromConfig, normalizeToggle, setToggleInYaml } = require('../src/picker/sessions-sort-config');

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

// Умолчания — это ещё и вид списка до того, как чекбоксы появились: путь,
// событие, деньги и контекст были видны всегда, id — нет.
test('PICKER_TOGGLES keeps the pre-checkbox look as the default', () => {
  assert.deepStrictEqual(PICKER_TOGGLES, {
    showPaths: true,
    showEvent: true,
    showId: false,
    showCost: true,
    showContext: true,
  });
});

test('readToggleFromConfig takes either the windows slice or the full config', () => {
  assert.strictEqual(readToggleFromConfig(null, 'showPaths'), true);
  assert.strictEqual(readToggleFromConfig({}, 'showPaths'), true);
  assert.strictEqual(readToggleFromConfig({ showPaths: false }, 'showPaths'), false);
  assert.strictEqual(
    readToggleFromConfig({ modules: { windows: { showPaths: false } } }, 'showPaths'), false);
  assert.strictEqual(readToggleFromConfig({ showPaths: true }, 'showPaths'), true);
});

test('readToggleFromConfig honours each key own default', () => {
  assert.strictEqual(readToggleFromConfig({}, 'showId'), false);
  assert.strictEqual(readToggleFromConfig({ showId: true }, 'showId'), true);
  assert.strictEqual(readToggleFromConfig({}, 'showCost'), true);
  assert.strictEqual(readToggleFromConfig({ showContext: false }, 'showContext'), false);
});

test('readTogglesFromConfig returns every toggle at once', () => {
  assert.deepStrictEqual(readTogglesFromConfig({ showEvent: false, showId: true }), {
    showPaths: true,
    showEvent: false,
    showId: true,
    showCost: true,
    showContext: true,
  });
  assert.deepStrictEqual(Object.keys(readTogglesFromConfig({})), Object.keys(PICKER_TOGGLES));
});

// Ключ приходит из payload пикера, а по нему потом пишут в config.yml.
test('isPickerToggle rejects anything not in the table', () => {
  assert.strictEqual(isPickerToggle('showPaths'), true);
  assert.strictEqual(isPickerToggle('showContext'), true);
  assert.strictEqual(isPickerToggle('sessionsSort'), false);
  assert.strictEqual(isPickerToggle('__proto__'), false);
  assert.strictEqual(isPickerToggle('toString'), false);
  assert.strictEqual(isPickerToggle(undefined), false);
});

test('normalizeToggle falls back to the key own default', () => {
  assert.strictEqual(normalizeToggle('showId', undefined), false);
  assert.strictEqual(normalizeToggle('showPaths', undefined), true);
  assert.strictEqual(normalizeToggle('showId', 'true'), true);
  assert.strictEqual(normalizeToggle('showCost', 'off'), false);
});

test('setToggleInYaml replaces or inserts under windows', () => {
  const withKey =
    'modules:\n' +
    '  windows:\n' +
    '    sessionsSort: cost\n' +
    '    showPaths: true\n';
  assert.match(setToggleInYaml(withKey, 'showPaths', false), /^\s*showPaths:\s*false\s*$/m);
  assert.doesNotMatch(setToggleInYaml(withKey, 'showPaths', false), /showPaths:\s*true/);

  const missing =
    'modules:\n' +
    '  windows:\n' +
    '    sessionsSort: cost\n';
  assert.match(setToggleInYaml(missing, 'showEvent', false),
    /windows:\n\s+showEvent: false\n\s+sessionsSort: cost/);
  assert.match(setToggleInYaml(missing, 'showContext', false),
    /windows:\n\s+showContext: false\n\s+sessionsSort: cost/);
  assert.match(setToggleInYaml(missing, 'showId', true),
    /windows:\n\s+showId: true\n\s+sessionsSort: cost/);
});
