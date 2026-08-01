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
    // «Работа встала, посмотри» приходит двумя путями: stop и fail пишут
    // review сразу, а «Claude is waiting for your input» — через минуту после
    // остановки, и хук записывает его как idle, потому что описывает событие,
    // а не его смысл. Смысл у них один, и цвет должен быть один.
    //
    // Гаснет оно по фокусу, а не по времени: agentSeen означает, что окно
    // выходило на передний план уже после этой записи. Ровно так ведёт себя и
    // сам Windows с подсветкой кнопки на таскбаре, и ожидание от списка такое
    // же — перешёл и посмотрел, значит больше не висит.
    // Вопрос гаснет по тому же правилу. Агент при этом остаётся заблокированным,
    // и это осознанный размен: список, который продолжает звать после того, как
    // на сессию уже сходили, быстро перестаёт что-либо значить.
    const needsAttention = session.agentState === 'question'
      || session.agentState === 'review'
      || (session.agentState === 'idle' && session.agentEvent === 'attention');
    if (needsAttention) {
      if (session.agentSeen) return 'idle';
      return session.agentState === 'question' ? 'question' : 'review';
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

  /**
   * Текстовый статус рядом с возрастом.
   *
   * Состояние и событие показываются вместе, потому что по отдельности они
   * недоговаривают: `review` бывает и от `stop`, и от `fail`, а `attention`
   * приходит и на вопрос, и на простой. Пара читается однозначно.
   *
   * Событие опускается, когда совпадает с состоянием, — дублировать слово ради
   * симметрии незачем.
   */
  function stateText(session) {
    if (!session || !session.open || !session.agentState) return '';
    const { agentState, agentEvent } = session;
    if (!agentEvent || agentEvent === agentState) return agentState;
    return `${agentState} · ${agentEvent}`;
  }

  function stateHtml(session) {
    const text = stateText(session);
    return `<div class="state">${escapeHtml(text)}</div>`;
  }

  /** Пустой элемент вместо пропуска: колонка возраста не должна прыгать. */
  function ageHtml(session, nowSec) {
    const age = formatAge(session && session.lastActivity, nowSec);
    return `<div class="age">${age}</div>`;
  }

  // Домашний каталог агента в пути ничего не сообщает: он одинаков у всех
  // сессий и занимает треть строки. Имя пользователя не зашито — агенты живут
  // и на других машинах.
  const HOME_PREFIX = /^\/home\/[^/]+/;

  // Уведомление о простое. Приходит тем же событием attention, что и просьба о
  // разрешении, и именно поэтому раньше попадало в подсказку — по нему одному
  // и различались жёлтый кружок с серым. Но различает их теперь сам статус, а в
  // подсказке эта строка висит на каждой отдохнувшей сессии и вытесняет то,
  // ради чего в подсказку и смотрят.
  const IDLE_NOTICE = 'waiting for your input';

  /** Путь агента без домашнего каталога. */
  function shortPath(cwd) {
    return String(cwd ?? '').replace(HOME_PREFIX, '~');
  }

  /**
   * Подсказка при наведении на строку.
   *
   * Здесь оседает то, чему в строке не хватает места: полный путь (в строке он
   * обрезан многоточием), чем сессия закончила и текст уведомления агента.
   *
   * Пустая строка означает «подсказки нет» — вызывающий не добавляет атрибут,
   * иначе браузер показывал бы пустую рамку.
   */
  function rowTitle(session) {
    if (!session) return '';
    const lines = [];
    if (session.cwd) lines.push(shortPath(session.cwd));
    // Первая строка последнего ответа агента. Отвечает на вопрос «чем эта
    // сессия закончила», на который ни кружок, ни заголовок окна не отвечают:
    // «Закоммитил — ea527f0, рабочее дерево чистое» против «Дизайн, секция 1
    // из 5». Отбита пустой строкой от пути — это разные вещи, и глазом их
    // проще разделить, чем прочитать подряд.
    //
    // У работающей сессии свежей сводки нет — она отвечает за текущий ход, а он
    // ещё идёт. Тогда показывается последняя известная: в строке её нет, а в
    // подсказке она к месту, там и спрашивают «на чём эта сессия встала».
    const summary = session.agentSummary || session.agentLastSummary;
    if (summary) {
      if (lines.length) lines.push('');
      lines.push(summary);
    }
    const message = session.agentMessage ?? '';
    if (message && !message.includes(IDLE_NOTICE)) lines.push(message);
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

  return {
    statusDotHtml, formatAge, ageHtml, stateText, stateHtml,
    shortPath, rowTitle, titleAttr, escapeHtml,
  };
});
