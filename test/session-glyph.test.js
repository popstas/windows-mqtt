const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, statusDotHtml } = require('../frontend-src/session-glyph');

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

test('statusDotHtml marks a live session open', () => {
  assert.strictEqual(
    statusDotHtml({ open: true }),
    '<div class="dot open"></div>'
  );
});

test('statusDotHtml marks a remembered-but-closed session closed', () => {
  assert.strictEqual(
    statusDotHtml({ open: false }),
    '<div class="dot closed"></div>'
  );
});

test('statusDotHtml treats a missing open flag as closed rather than open', () => {
  // Defaulting the other way would paint a dead slot green, which is the one
  // thing the dot exists to tell apart.
  assert.strictEqual(statusDotHtml({}), '<div class="dot closed"></div>');
});

test('statusDotHtml ignores the geometry fields the row no longer draws', () => {
  const session = {
    open: true,
    bounds: { x: 100, y: 50, width: 200, height: 100 },
    monitorBounds: { x: 0, y: 0, width: 1000, height: 500 },
  };
  assert.strictEqual(statusDotHtml(session), '<div class="dot open"></div>');
});
