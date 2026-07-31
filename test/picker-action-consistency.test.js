/**
 * sessions.html sends `action` names to src/modules/windows.js's stdinActions
 * map (via the `windows/claude-focus` etc. IPC action). There is no compiler
 * or runtime guard linking the two: a typo on either side is a silent,
 * native-window-only failure. The native windows11-manager layer can't be
 * mocked into existence for a real end-to-end test (no native binaries in
 * tests), so this is a text-level consistency check instead — the cheapest
 * guard available, per the project's established pattern of extracting a
 * pure seam rather than faking the native layer.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sessionsHtmlPath = path.join(__dirname, '..', 'sessions.html');
const windowsModulePath = path.join(__dirname, '..', 'src', 'modules', 'windows.js');

// Matches `action: 'windows/foo'` / `action: "windows/foo"` regardless of
// quote style or the exact whitespace around the colon, so reasonable
// reformatting of sessions.html doesn't break this.
function extractSentActions(html) {
  const actions = new Set();
  const re = /\baction\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(html))) actions.add(m[1]);
  return actions;
}

// Matches the `'windows/foo': ...` keys of the stdinActions object literal.
// Scoped to the `windows/` prefix (rather than parsing the object literal's
// braces) so it survives reformatting/reordering of the map.
function extractRegisteredActions(js) {
  const actions = new Set();
  const re = /'(windows\/[\w-]+)'\s*:/g;
  let m;
  while ((m = re.exec(js))) actions.add(m[1]);
  return actions;
}

test('every action sessions.html sends via picker_send is registered in windows.js', () => {
  const html = fs.readFileSync(sessionsHtmlPath, 'utf8');
  const js = fs.readFileSync(windowsModulePath, 'utf8');

  const sent = extractSentActions(html);
  assert.ok(sent.size > 0, 'expected to find at least one action: literal in sessions.html');

  const registered = extractRegisteredActions(js);
  assert.ok(registered.size > 0, 'expected to find at least one windows/* key in windows.js');

  for (const action of sent) {
    assert.ok(
      registered.has(action),
      `sessions.html sends action '${action}' but src/modules/windows.js has no such stdinActions key`
    );
  }
});
