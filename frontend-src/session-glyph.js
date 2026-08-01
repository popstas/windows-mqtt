// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionGlyph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Состояние агента внутри окна приходит из windows11-manager (claude-wt),
  // который читает его из файлов, что пишет хук wt-progress.sh на стороне
  // агента. Ключи здесь — ровно те строки, что пишет хук.
  const AGENT_DOT = {
    active: 'active',      // зелёный: агент работает
    question: 'question',  // жёлтый: агент о чём-то спрашивает
    review: 'review',      // оранжевый: закончил, результат ещё не смотрели
    idle: 'idle',          // серый: постоял законченным, считается проверенным
  };

  /**
   * Кружок состояния сессии.
   *
   * У закрытой сессии кружка нет — но место под него остаётся: строки стоят в
   * одной колонке, и убрать элемент целиком значило бы сдвинуть текст закрытых
   * строк относительно живых.
   *
   * Открытая сессия без состояния — не ошибка, а «хук не установлен или ещё не
   * сработал»; такой кружок серый, как у простаивающей. Красить её зелёным, как
   * раньше красили любую живую, теперь нельзя: зелёный стал означать «агент
   * прямо сейчас работает», и врать им не стоит.
   */
  function dotState(session) {
    // «Claude is waiting for your input» — не простой, а «агент закончил и ждёт
    // тебя»: это уведомление приходит через минуту после остановки, то есть
    // работа встала и результат никто не смотрел. Цвет тот же, что у stop.
    // Хук пишет тут idle, потому что описывает событие, а не его смысл;
    // решение, каким это показать, принимается здесь.
    //
    // Гаснет оно по фокусу, а не по времени: agentSeen означает, что окно
    // выходило на передний план уже после этой записи. Ровно так ведёт себя и
    // сам Windows с подсветкой кнопки на таскбаре, и ожидание от списка такое
    // же — перешёл и посмотрел, значит больше не висит.
    if (session.agentState === 'idle' && session.agentEvent === 'attention') {
      return session.agentSeen ? 'idle' : 'review';
    }
    return AGENT_DOT[session.agentState] || 'idle';
  }

  function statusDotHtml(session) {
    if (!session || !session.open) return '<div class="dot closed"></div>';
    return `<div class="dot ${dotState(session)}"></div>`;
  }

  /**
   * Возраст последней активности: now, 5m, 2h, 3d.
   *
   * `timestamp` — epoch-секунды, как их отдаёт claude-wt: и слоты, и хуки
   * пишут время в секундах. `nowSec` передаётся снаружи, чтобы функция
   * осталась чистой и проверяемой.
   */
  function formatAge(timestamp, nowSec) {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    const delta = Math.max(0, Math.floor(nowSec - timestamp));
    if (delta < 60) return 'now';
    if (delta < 3600) return `${Math.floor(delta / 60)}m`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
    return `${Math.floor(delta / 86400)}d`;
  }

  /** Пустой элемент вместо пропуска: колонка возраста не должна прыгать. */
  function ageHtml(session, nowSec) {
    const age = formatAge(session && session.lastActivity, nowSec);
    return `<div class="age">${age}</div>`;
  }

  /**
   * Подсказка при наведении на строку.
   *
   * Здесь оседает то, чему в строке не хватает места: полный cwd (в строке он
   * обрезан многоточием) и текст уведомления агента. Последний — единственное,
   * что отличает «нужно разрешение» от «просто жду ввода»: оба приходят одним
   * событием attention, а кружки у них разные.
   *
   * Пустая строка означает «подсказки нет» — вызывающий не добавляет атрибут,
   * иначе браузер показывал бы пустую рамку.
   */
  function rowTitle(session) {
    if (!session) return '';
    const lines = [];
    if (session.cwd) lines.push(session.cwd);
    if (session.agentMessage) lines.push(session.agentMessage);
    return lines.join('\n');
  }

  /** Готовый атрибут title, уже экранированный, либо пустая строка. */
  function titleAttr(session) {
    const text = rowTitle(session);
    return text ? ` title="${escapeHtml(text)}"` : '';
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  return { statusDotHtml, formatAge, ageHtml, rowTitle, titleAttr, escapeHtml };
});
