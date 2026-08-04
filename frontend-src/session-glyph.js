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
   * Возраст последней активности: 31s, 5m, 2h, 3d.
   *
   * `timestamp` — epoch-секунды, как их отдаёт claude-wt: и слоты, и хуки
   * пишут время в секундах. `nowSec` передаётся снаружи, чтобы функция
   * осталась чистой и проверяемой.
   *
   * Первая минута — в секундах, а не словом `now`. Слово отвечало «недавно» на
   * вопрос «сколько», и у работающей сессии, где колонка показывает длину
   * текущего хода, оно съедало ровно ту минуту, за которую по строке и видно,
   * началась работа только что или уже идёт.
   */
  function formatAge(timestamp, nowSec) {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    const delta = Math.max(0, Math.floor(nowSec - timestamp));
    if (delta < 60) return `${delta}s`;
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
    if (!session || !session.agentState) return '';
    // Закрытая сессия ничего не делает — кроме той, за которую работает фоновый
    // агент (`claude agents`): своего окна у него нет, и «окно закрыто» про него
    // ничего не сообщает. Строка при этом остаётся строкой родителя.
    if (!session.open && !session.agentBackground) return '';
    const { agentState, agentEvent } = session;
    const text = !agentEvent || agentEvent === agentState
      ? agentState
      : `${agentState} · ${agentEvent}`;
    return session.agentBackground ? `bg ${text}` : text;
  }

  /**
   * Короткий id — то, чем сессию называют снаружи: `claude --resume`, имя файла
   * транскрипта, строка в логе демона. Четыре знака — столько же, сколько
   * приписывает к заголовку `labelSessions`, когда две сессии называются
   * одинаково; узнать строку хватает, а колонка не съедает место у сводки.
   *
   * У сессии, за которую работает фоновый агент, показывается его id: искать по
   * нему будут именно того, кто пишет, а не того, от кого он форкнут.
   */
  function shortSessionId(session) {
    return String(session?.agentSessionId || session?.id || '').slice(0, 4);
  }

  /**
   * Статус агента в правой колонке.
   *
   * Выключенный чекбокс убирает колонку целиком, а не рисует пустую. Пустой
   * элемент нужен там, где у соседних строк колонка есть: без него правые
   * колонки разъезжаются. Чекбокс же выключен сразу у всего списка — и
   * разъезжаться нечему.
   *
   * Раньше эта колонка с выключенным «show event» показывала id: место одно,
   * вопрос один — «что это за строка». Теперь у id свой чекбокс, и обе величины
   * могут стоять рядом.
   */
  function stateHtml(session, showEvent = true) {
    if (!showEvent) return '';
    return `<div class="state">${escapeHtml(stateText(session))}</div>`;
  }

  /** Короткий id сессии отдельной колонкой; чем он полезен — см. shortSessionId. */
  function sessionIdHtml(session, showId = false) {
    if (!showId) return '';
    return `<div class="sid">${escapeHtml(shortSessionId(session))}</div>`;
  }

  /**
   * Имя сессии для заголовка диалога.
   *
   * Меню действий приходит с одним `label` и без заголовка окна, список — с
   * обоими; безымянная сессия остаётся с id, потому что пустой заголовок не
   * сообщает ничего.
   */
  function sessionName(session) {
    return session?.title || session?.label || String(session?.id ?? '');
  }

  /**
   * Хоткей проекта (`^F12`) отдельной колонкой.
   *
   * Раньше он висел подписью прямо в имени сессии и рвал её на двух местах: имя
   * обрезается многоточием, и подпись то уезжала за край, то отталкивала метку
   * PR. У проекта хоткей один на все его сессии, так что читается он как
   * признак строки, а не как часть названия, — и колонка ему подходит больше.
   *
   * Пустой элемент вместо пропуска у сессий без хоткея: колонки справа стоят
   * друг за другом, и дырка сдвинула бы соседние строки.
   */
  function hotkeyHtml(session, showHotkey = true) {
    if (!showHotkey) return '';
    return `<div class="hk">${escapeHtml(session?.hotkey ?? '')}</div>`;
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
  function usageHtml(session, { showCost = true, showContext = true } = {}) {
    // Обе величины выключены — колонки нет вовсе; см. stateHtml о том, почему
    // выключенный чекбокс не оставляет за собой пустой элемент.
    if (!showCost && !showContext) return '';
    const pct = Number.isFinite(session?.agentContextPct) ? session.agentContextPct : 0;
    const cost = Number.isFinite(session?.agentCostUsd) ? session.agentCostUsd : 0;
    const parts = [];
    const level = contextLevel(pct);
    if (showCost && cost > 0) parts.push(`<span class="cost">$${cost}</span>`);
    if (showContext && pct > 0) parts.push(`<span class="ctx${level ? ` ${level}` : ''}">${pct}%</span>`);
    // Разделитель тот же, что у stateText: это две независимые величины, а не
    // одно число из двух частей, и пробела для такого мало. На панель он не
    // уезжает — во встроенном шрифте openHASP точки нет, там пустой квадрат.
    //
    // Пустой элемент вместо пропуска — по той же причине, что и у возраста:
    // колонки справа стоят друг за другом и не должны разъезжаться.
    return `<div class="usage">${parts.join(' · ')}</div>`;
  }

  /**
   * Возраст в строке. У работающей сессии — время текущего хода.
   *
   * Колонка отвечает на вопрос «сколько уже», и у работающей сессии прежний
   * ответ был бесполезен: `lastActivity` двигает каждый вызов инструмента, а их
   * десятки в минуту, — там вечно стояло `now`. Спрашивают же про другое:
   * сколько крутится текущая команда. Возраст всей сессии для этого тоже не
   * годится, он про «46m» независимо от того, работает она или спит час.
   *
   * Метка есть только у сессий, поднятых после правки в хуке; без неё колонка
   * остаётся прежней. Пустой элемент вместо пропуска: колонки справа стоят
   * друг за другом и не должны разъезжаться.
   */
  function ageHtml(session, nowSec) {
    const working = Boolean(session) && session.agentState === 'active';
    const turnAt = working && Number.isFinite(session.agentTurnAt) ? session.agentTurnAt : 0;
    const age = formatAge(turnAt || (session && session.lastActivity), nowSec);
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

  // Номер PR берётся из хвоста ссылки, отдельного поля для него нет: ссылка и
  // так проверена на форму в windows11-manager, и второе поле означало бы два
  // источника правды об одном и том же.
  //
  // Форма сегмента owner/repo — только то, что GitHub туда и пускает: буквы,
  // цифры, точка, подчёркивание, дефис. `[^/]+` («что угодно, кроме слэша»)
  // пропускал бы и `&`, `|`, `"`, пробел, перевод строки внутри сегмента — а
  // ссылка уходит в аргумент `cmd.exe /c start` без экранирования.
  //
  // Копия этой регулярки и разбора живёт в src/picker/pr-url.js (серверная
  // сторона: sessions.html не может require'ить его, браузер требует именно
  // этот файл как <script>). Расхождение между копиями ловит
  // test/pr-url-parity.test.js.
  function prNumber(url) {
    const m = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/(\d+)$/.exec(url ?? '');
    return m ? m[1] : '';
  }

  /**
   * Метка PR в строке: «↗ #3».
   *
   * Текстом, а не картинкой: ассетов у пикера нет вовсе, а стрелка есть в Segoe
   * UI, которым он и набран.
   */
  function prBadgeHtml(session) {
    const num = prNumber(session?.pr_url);
    return num ? `<span class="pr">↗ #${num}</span>` : '';
  }

  return {
    statusDotHtml, formatAge, ageHtml, stateText, shortSessionId, stateHtml,
    sessionIdHtml, sessionName, hotkeyHtml, contextLevel, usageHtml,
    shortPath, rowTitle, titleAttr, escapeHtml,
    prNumber, prBadgeHtml,
  };
});
