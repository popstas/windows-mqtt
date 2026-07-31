const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, glyphHtml } = require('../frontend-src/session-glyph');

const monitor = { x: 0, y: 0, width: 1000, height: 500 };

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

test('glyphHtml places the inner rectangle using percentages of the monitor rect', () => {
  const session = { monitorBounds: monitor, bounds: { x: 100, y: 50, width: 200, height: 100 } };
  assert.strictEqual(
    glyphHtml(session),
    '<div class="glyph"><i style="left:10%;top:10%;width:20%;height:20%"></i></div>'
  );
});

test('glyphHtml renders an empty glyph when bounds is null', () => {
  const session = { monitorBounds: monitor, bounds: null };
  assert.strictEqual(glyphHtml(session), '<div class="glyph"></div>');
});

test('glyphHtml renders an empty glyph when monitorBounds is missing', () => {
  const session = { bounds: { x: 100, y: 50, width: 200, height: 100 } };
  assert.strictEqual(glyphHtml(session), '<div class="glyph"></div>');
});

test('glyphHtml renders an empty glyph when the monitor rect has zero width', () => {
  const session = {
    monitorBounds: { x: 0, y: 0, width: 0, height: 500 },
    bounds: { x: 100, y: 50, width: 200, height: 100 },
  };
  assert.strictEqual(glyphHtml(session), '<div class="glyph"></div>');
});

test('glyphHtml places a window flush against the monitor far edge exactly at the edge', () => {
  const session = { monitorBounds: monitor, bounds: { x: 900, y: 450, width: 100, height: 50 } };
  assert.strictEqual(
    glyphHtml(session),
    '<div class="glyph"><i style="left:90%;top:90%;width:10%;height:10%"></i></div>'
  );
});

test('glyphHtml caps width/height so an oversized window cannot overflow past the frame edge', () => {
  // bounds extends 300 units past the monitor's right edge; raw width% would be 50,
  // but only 20% of room remains to the right of left:80%, so it must be capped there.
  const session = { monitorBounds: monitor, bounds: { x: 800, y: 100, width: 500, height: 100 } };
  const html = glyphHtml(session);
  assert.strictEqual(
    html,
    '<div class="glyph"><i style="left:80%;top:20%;width:20%;height:20%"></i></div>'
  );
});

test('glyphHtml floors width/height to a minimum visible size for a tiny window', () => {
  const session = { monitorBounds: monitor, bounds: { x: 100, y: 100, width: 5, height: 2 } };
  assert.strictEqual(
    glyphHtml(session),
    '<div class="glyph"><i style="left:10%;top:20%;width:4%;height:4%"></i></div>'
  );
});

test('glyphHtml clamps a window positioned above/left of the monitor origin to 0', () => {
  const session = { monitorBounds: monitor, bounds: { x: -50, y: -50, width: 200, height: 100 } };
  assert.strictEqual(
    glyphHtml(session),
    '<div class="glyph"><i style="left:0%;top:0%;width:20%;height:20%"></i></div>'
  );
});
