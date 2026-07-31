// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionGlyph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // The window is a rectangle of the monitor scaled to fit the glyph; the
  // filled part is where the window sits on it.
  function glyphHtml(session) {
    const mb = session.monitorBounds;
    const b = session.bounds;
    if (!mb || !b || !mb.width || !mb.height) return '<div class="glyph"></div>';
    const left = Math.max(0, Math.min(100, ((b.x - mb.x) / mb.width) * 100));
    const top = Math.max(0, Math.min(100, ((b.y - mb.y) / mb.height) * 100));
    const width = Math.max(4, Math.min(100 - left, (b.width / mb.width) * 100));
    const height = Math.max(4, Math.min(100 - top, (b.height / mb.height) * 100));
    return `<div class="glyph"><i style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></i></div>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  return { glyphHtml, escapeHtml };
});
