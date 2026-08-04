// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // В Node: требуем зависимость из соседнего модуля.
    module.exports = factory(require('./session-glyph'));
  } else {
    // В браузере: получаем зависимость из глобального объекта SessionGlyph,
    // который был загружен раньше как <script>.
    root.SessionInfo = factory(root.SessionGlyph);
  }
})(typeof self !== 'undefined' ? self : this, function (SessionGlyph) {
  /**
   * Отметка времени — часы плюс возраст: «14:32 · 5m» или «14:32 · 31s».
   *
   * Формат совпадает с тем, что показывает правая колонка списка, благодаря
   * переиспользованию formatAge из session-glyph.js. Одних часов мало
   * (вчерашние 14:32 выглядят как сегодняшние), одного возраста тоже (по нему
   * не сопоставить с историей терминала).
   */
  function stamp(epochSec, nowSec) {
    if (!epochSec) return '';
    const d = new Date(epochSec * 1000);
    const p = n => String(n).padStart(2, '0');
    const age = SessionGlyph.formatAge(epochSec, nowSec);
    return `${p(d.getHours())}:${p(d.getMinutes())} · ${age}`;
  }

  /**
   * Все поля сессии, которые есть в строке списка, — таблицей.
   *
   * Пустые пропускаются: пустая строка в таблице выглядит как поломка, а не как
   * «данных нет». Порядок — от опознания сессии к подробностям агента.
   */
  function buildSessionInfoRows(session, nowSec) {
    const s = session ?? {};
    const b = s.bounds;
    const rows = [
      ['id', s.id ?? ''],
      ['name', s.label ?? ''],
      ['cwd', s.cwd ?? ''],
      ['window', s.open ? `open · hwnd ${s.windowId ?? '—'}` : 'closed'],
      ['desktop', Number.isFinite(s.desktop) ? String(s.desktop) : ''],
      ['monitor', Number.isFinite(s.monitor) ? String(s.monitor) : ''],
      ['bounds', b ? `${b.width}×${b.height} @ ${b.x},${b.y}` : ''],
      ['state', s.agentState ?? ''],
      ['event', s.agentEvent ?? ''],
      ['message', s.agentMessage ?? ''],
      ['seen', s.agentState ? (s.agentSeen ? 'yes' : 'no') : ''],
      ['prompt', s.agentPrompt ?? ''],
      ['summary', s.agentDescription ?? ''],
      ['cost', s.agentCostUsd ? `$${s.agentCostUsd}` : ''],
      ['context', s.agentContextPct ? `${s.agentContextPct}%` : ''],
      ['branch', s.branch ?? ''],
      ['pr_url', s.pr_url ?? ''],
      ['agent', s.agentBackground && s.agentSessionId ? `background · ${s.agentSessionId}` : ''],
      ['started', stamp(s.agentStarted ?? 0, nowSec)],
      ['last activity', stamp(s.lastActivity ?? 0, nowSec)],
      ['focused', stamp(s.focusedAt ?? 0, nowSec)],
    ];
    return rows
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([label, value]) => ({ label, value: String(value) }));
  }

  return { buildSessionInfoRows };
});
