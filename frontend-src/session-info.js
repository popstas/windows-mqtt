// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionInfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Возраст в том же виде, что в правой колонке списка: 45s, 12m, 3h, 2d. */
  function age(sec) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
  }

  /**
   * Отметка времени — часы плюс возраст: «14:32 · 5m».
   *
   * Одних часов мало (вчерашние 14:32 выглядят как сегодняшние), одного
   * возраста тоже (по нему не сопоставить с историей терминала).
   */
  function stamp(epochSec, nowSec) {
    if (!epochSec) return '';
    const d = new Date(epochSec * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} · ${age(Math.max(0, nowSec - epochSec))}`;
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
      ['agent', s.agentBackground ? `background · ${s.agentSessionId ?? ''}` : ''],
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
