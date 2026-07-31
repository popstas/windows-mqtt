// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionGlyph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // A dot carrying the one thing worth seeing at a glance: green when the
  // session's window is alive, grey when it is only a remembered slot.
  function statusDotHtml(session) {
    return `<div class="dot ${session.open ? 'open' : 'closed'}"></div>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  return { statusDotHtml, escapeHtml };
});
