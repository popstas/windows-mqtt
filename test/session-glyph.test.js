const { test } = require('node:test');
const assert = require('node:assert');
const {
  escapeHtml, statusDotHtml, formatAge, ageHtml, rowTitle, titleAttr,
} = require('../frontend-src/session-glyph');

test('escapeHtml escapes ampersand, angle brackets, and double quotes', () => {
  assert.strictEqual(
    escapeHtml('a & b < c > d " e'),
    'a &amp; b &lt; c &gt; d &quot; e'
  );
});

test('escapeHtml neutralizes a hostile window title that tries to break out of an attribute and inject markup', () => {
  const hostile = 'Report" onmouseover="alert(1)"><script>alert(2)</script> & <img src=x onerror=alert(3)>';
  const out = escapeHtml(hostile);
  assert.strictEqual(
    out,
    'Report&quot; onmouseover=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(3)&gt;'
  );
  assert.ok(!out.includes('<script>'), 'must not leave an openable script tag');
  assert.ok(!out.includes('">'), 'must not leave a closed, escapable attribute');
});

test('escapeHtml leaves single quotes and other safe characters unchanged', () => {
  assert.strictEqual(escapeHtml("it's fine"), "it's fine");
});

test('escapeHtml coerces non-string input to a string first', () => {
  assert.strictEqual(escapeHtml(123), '123');
});

test('statusDotHtml paints each agent state its own colour class', () => {
  for (const state of ['active', 'question', 'review', 'idle']) {
    assert.strictEqual(
      statusDotHtml({ open: true, agentState: state }),
      `<div class="dot ${state}"></div>`
    );
  }
});

test('statusDotHtml falls back to idle for a live session with no agent state', () => {
  // The hook may not be installed, or may not have fired yet. Green would
  // claim the agent is working right now, which is exactly what is unknown.
  assert.strictEqual(
    statusDotHtml({ open: true }),
    '<div class="dot idle"></div>'
  );
});

test('statusDotHtml ignores an agent state it does not know', () => {
  // The state file is written by another process on another machine; an
  // unknown string must not become a CSS class of its own.
  assert.strictEqual(
    statusDotHtml({ open: true, agentState: 'exploded' }),
    '<div class="dot idle"></div>'
  );
});

test('statusDotHtml marks a remembered-but-closed session closed', () => {
  assert.strictEqual(
    statusDotHtml({ open: false }),
    '<div class="dot closed"></div>'
  );
});

test('statusDotHtml keeps a closed session closed even when a state lingers', () => {
  // The window is gone; the last state the agent wrote before it went says
  // nothing about now.
  assert.strictEqual(
    statusDotHtml({ open: false, agentState: 'active' }),
    '<div class="dot closed"></div>'
  );
});

test('statusDotHtml treats a missing open flag as closed rather than open', () => {
  // Defaulting the other way would paint a dead slot green, which is the one
  // thing the dot exists to tell apart.
  assert.strictEqual(statusDotHtml({}), '<div class="dot closed"></div>');
});

test('statusDotHtml survives a missing session object', () => {
  assert.strictEqual(statusDotHtml(undefined), '<div class="dot closed"></div>');
});

test('statusDotHtml ignores the geometry fields the row no longer draws', () => {
  const session = {
    open: true,
    agentState: 'active',
    bounds: { x: 100, y: 50, width: 200, height: 100 },
    monitorBounds: { x: 0, y: 0, width: 1000, height: 500 },
  };
  assert.strictEqual(statusDotHtml(session), '<div class="dot active"></div>');
});

const NOW = 1785600000;

test('formatAge steps through now, minutes, hours and days', () => {
  assert.strictEqual(formatAge(NOW, NOW), 'now');
  assert.strictEqual(formatAge(NOW - 59, NOW), 'now');
  assert.strictEqual(formatAge(NOW - 60, NOW), '1m');
  assert.strictEqual(formatAge(NOW - 59 * 60, NOW), '59m');
  assert.strictEqual(formatAge(NOW - 3600, NOW), '1h');
  assert.strictEqual(formatAge(NOW - 23 * 3600, NOW), '23h');
  assert.strictEqual(formatAge(NOW - 86400, NOW), '1d');
  assert.strictEqual(formatAge(NOW - 3 * 86400, NOW), '3d');
});

test('formatAge returns nothing for a session that never reported activity', () => {
  assert.strictEqual(formatAge(null, NOW), '');
  assert.strictEqual(formatAge(0, NOW), '');
  assert.strictEqual(formatAge(undefined, NOW), '');
});

test('formatAge clamps a timestamp from the future to now', () => {
  // Clocks on the two machines need not agree, and a negative age would
  // render as "-1m".
  assert.strictEqual(formatAge(NOW + 120, NOW), 'now');
});

test('rowTitle puts the full cwd and the agent message on separate lines', () => {
  assert.strictEqual(
    rowTitle({ cwd: '/home/popstas/projects/python/telegram-assistant', agentMessage: 'Claude needs your permission' }),
    '/home/popstas/projects/python/telegram-assistant\nClaude needs your permission'
  );
});

test('rowTitle drops whichever part is missing', () => {
  assert.strictEqual(rowTitle({ cwd: '/home/popstas' }), '/home/popstas');
  assert.strictEqual(rowTitle({ agentMessage: 'waiting' }), 'waiting');
  assert.strictEqual(rowTitle({}), '');
  assert.strictEqual(rowTitle(undefined), '');
});

test('titleAttr omits the attribute entirely when there is nothing to say', () => {
  // An empty title= paints a blank tooltip box on hover, which is worse than
  // no tooltip at all.
  assert.strictEqual(titleAttr({}), '');
  assert.strictEqual(titleAttr(undefined), '');
});

test('titleAttr escapes a message that would break out of the attribute', () => {
  const out = titleAttr({ agentMessage: 'say "hi" <script>alert(1)</script>' });
  assert.strictEqual(
    out,
    ' title="say &quot;hi&quot; &lt;script&gt;alert(1)&lt;/script&gt;"'
  );
  assert.ok(!out.includes('<script>'), 'must not leave an openable script tag');
});

test('ageHtml always emits the element so the column cannot jump', () => {
  assert.strictEqual(ageHtml({ lastActivity: NOW - 7200 }, NOW), '<div class="age">2h</div>');
  assert.strictEqual(ageHtml({}, NOW), '<div class="age"></div>');
  assert.strictEqual(ageHtml(undefined, NOW), '<div class="age"></div>');
});
