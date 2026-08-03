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

  // Пороги подсветки контекста. До тридцати процентов заполненность ничего не
  // значит — она такая у любой сессии после пары ходов, и красить её значило бы
  // красить весь список. Дальше это уже предупреждение: за сорока процентами
  // начинают выпадать ранние куски разговора, и лучше узнать об этом из списка,
  // чем из ответа, который забыл, о чём шла речь.
  const CONTEXT_WARN = 30;
  const CONTEXT_HOT = 40;

  function contextLevel(pct) {
    if (pct >= CONTEXT_HOT) return 'hot';
    if (pct >= CONTEXT_WARN) return 'warn';
    return '';
  }

  /**
   * Деньги и контекст: «$2 13%».
   *
   * Тот же порядок, что и на панели openHASP, — список и плата показывают одно
   * и то же, и разный порядок заставлял бы перечитывать. Подсвечены только
   * проценты: по ним решают, не пора ли начинать заново, а стоимость — справка.
   *
   * Ноль означает «данных нет», а не «ничего не потратила»: перехват
   * статуслайна стоит не у каждой сессии (см. claude-wt-statusline.sh). Такая
   * часть просто не показывается.
   */
  function usageHtml(session) {
    const pct = Number.isFinite(session?.agentContextPct) ? session.agentContextPct : 0;
    const cost = Number.isFinite(session?.agentCostUsd) ? session.agentCostUsd : 0;
    const parts = [];
    const level = contextLevel(pct);
    if (cost > 0) parts.push(`<span class="cost">$${cost}</span>`);
    if (pct > 0) parts.push(`<span class="ctx${level ? ` ${level}` : ''}">${pct}%</span>`);
    // Разделитель тот же, что у stateText: это две независимые величины, а не
    // одно число из двух частей, и пробела для такого мало. На панель он не
    // уезжает — во встроенном шрифте openHASP точки нет, там пустой квадрат.
    //
    // Пустой элемент вместо пропуска — по той же причине, что и у возраста:
    // колонки справа стоят друг за другом и не должны разъезжаться.
    return `<div class="usage">${parts.join(' · ')}</div>`;
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
    // Последний запрос человека — над сводкой ответа. В строке их нет (там
    // место только у пути), а в подсказке оба к месту: «что спросили» и
    // «чем ответили» читаются разными строками, а не одной кашей.
    if (session.agentPrompt) {
      if (lines.length) lines.push('');
      lines.push(session.agentPrompt);
    }
    // Первая строка последнего ответа агента. Отвечает на вопрос «чем эта
    // сессия закончила», на который ни кружок, ни заголовок окна не отвечают:
    // «Закоммитил — ea527f0, рабочее дерево чистое» против «Дизайн, секция 1
    // из 5».
    //
    // У работающей сессии свежей сводки нет — она отвечает за текущий ход, а он
    // ещё идёт. Тогда показывается последняя известная; склейку считает
    // windows11-manager (`agentDescription`), и ту же строку видят Home Assistant
    // и плата — три копии одного `||` уже разъезжались между собой.
    // Если промпт уже открыл блок — сводку не отбиваем пустой строкой снова.
    const summary = session.agentDescription ?? '';
    if (summary) {
      if (lines.length && !session.agentPrompt) lines.push('');
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
    contextLevel, usageHtml,
    shortPath, rowTitle, titleAttr, escapeHtml,
  };
});
