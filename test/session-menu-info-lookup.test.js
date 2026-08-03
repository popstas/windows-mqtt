/**
 * runMenuAction() in sessions.html used to open Session info with
 * `openInfo(rows[active])` — the same `active` index every other menu action
 * ignores in favour of `menuSessionId`. The list redraws every second whether
 * or not the Ctrl+K menu is open, and render() rebuilds `rows` in the current
 * sort order each time, so while the menu sits open the rows can reshuffle:
 * `active` stays a plain number and can end up pointing at a different
 * session than the one the menu's title named. There is no DOM in this test
 * runner (no bundler either), so this is a source-level regression check in
 * the same spirit as picker-action-consistency.test.js: it isolates the
 * `if (actionId === 'info')` branch's body and asserts it resolves the
 * session by `menuSessionId` (the `id` captured at the top of the function),
 * not by indexing `rows` with `active`.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sessionsHtmlPath = path.join(__dirname, '..', 'sessions.html');

function extractInfoBranchBody(html) {
  const fnStart = html.indexOf('async function runMenuAction()');
  assert.ok(fnStart >= 0, 'could not find runMenuAction() in sessions.html');
  const branchMarker = "if (actionId === 'info')";
  const branchStart = html.indexOf(branchMarker, fnStart);
  assert.ok(branchStart >= 0, "could not find the 'info' branch inside runMenuAction()");
  const braceOpen = html.indexOf('{', branchStart);
  const braceClose = html.indexOf('}', braceOpen);
  assert.ok(braceOpen >= 0 && braceClose > braceOpen, "could not isolate the 'info' branch body");
  return html.slice(braceOpen + 1, braceClose);
}

test("runMenuAction's 'info' branch resolves the session by menuSessionId, not by the rows[active] index", () => {
  const html = fs.readFileSync(sessionsHtmlPath, 'utf8');
  const body = extractInfoBranchBody(html);

  assert.ok(
    !/rows\[active\]/.test(body),
    "the 'info' branch must not use rows[active] — while the menu is open, render() can reshuffle " +
    'rows under the same active index, opening Session info for the wrong session'
  );
  assert.ok(
    /rows\.find\(/.test(body),
    "the 'info' branch must look the session up in rows by id (menuSessionId), e.g. rows.find(r => r.id === id)"
  );
});
