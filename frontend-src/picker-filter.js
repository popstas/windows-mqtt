// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating the filter to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PickerFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Префикс домашней директории Linux не участвует в поиске: иначе «home»
  // совпадает с каждой сессией под /home/popstas/.... Сам каталог проекта
  // `.../home` и ярлык с именем home по-прежнему находятся.
  function searchableCwd(cwd) {
    return String(cwd ?? '').replace(/^\/home(?=\/|$)/i, '');
  }

  function filterSessions(groups, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => ({ ...g, sessions: g.sessions.filter(s =>
        `${s.label} ${searchableCwd(s.cwd)}`.toLowerCase().includes(q)) }))
      .filter(g => g.sessions.length > 0);
  }

  return { filterSessions, searchableCwd };
});
