/** Pure shaping of the claude-wt session list for the picker. No I/O. */

// Сессия с неизвестным столом сортируется перед всеми настоящими.
const DESKTOP_UNKNOWN = -1;

const SORT_MODES = ['cost', 'oldest', 'newest', 'recent', 'name'];
const DEFAULT_SORT = 'cost';

function normalizeSort(mode) {
  return SORT_MODES.includes(mode) ? mode : DEFAULT_SORT;
}

function cycleSort(mode) {
  const current = normalizeSort(mode);
  const i = SORT_MODES.indexOf(current);
  return SORT_MODES[(i + 1) % SORT_MODES.length];
}

/**
 * Имя, под которым сессию видно везде: строка списка, поиск, заголовок диалога,
 * текст слота на панели openHASP.
 *
 * Раньше здесь же двойники — одинаковые имя и проект, то есть переоткрытая
 * сессия или пара «живая и протухшая» — получали к имени хвост из четырёх
 * знаков id: больше на строке ничего не различалось. Теперь у короткого id своя
 * колонка со своим чекбоксом, и хвост стал вторым способом показать то же самое
 * — в имени, где он мешает и в списке, и в заголовках диалогов, и на панели.
 *
 * Ничего, кроме показа, на label не завязано: строки списка узнаются по
 * `s:<id>`, слоты панели носят с собой `id`, фокус уходит тоже по id.
 */
function labelSessions(sessions) {
  return sessions.map(s => ({ ...s, label: s.title }));
}

function desktopLabel(desktop) {
  return desktop === null ? 'Desktop —' : `Desktop ${desktop}`;
}

function nameOf(s) {
  return s.label ?? s.title ?? '';
}

/** Missing / zero sort keys sink to the end so incomplete rows don't float up. */
function missingLast(aVal, bVal, asc) {
  const aMissing = !aVal;
  const bMissing = !bVal;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return asc ? aVal - bVal : bVal - aVal;
}

function tieBreak(a, b) {
  return nameOf(a).localeCompare(nameOf(b)) || String(a.id).localeCompare(String(b.id));
}

function compareSessions(a, b, mode) {
  const sort = normalizeSort(mode);
  let primary = 0;
  if (sort === 'cost') {
    primary = missingLast(a.agentCostUsd ?? 0, b.agentCostUsd ?? 0, false);
  } else if (sort === 'oldest') {
    primary = missingLast(a.agentStarted ?? 0, b.agentStarted ?? 0, true);
  } else if (sort === 'newest') {
    primary = missingLast(a.agentStarted ?? 0, b.agentStarted ?? 0, false);
  } else if (sort === 'recent') {
    primary = missingLast(a.lastActivity ?? 0, b.lastActivity ?? 0, false);
  } else if (sort === 'name') {
    primary = nameOf(a).localeCompare(nameOf(b));
  }
  return primary || tieBreak(a, b);
}

function sortGroupSessions(sessions, mode) {
  return sessions.sort((a, b) => compareSessions(a, b, mode));
}

/**
 * Живые сессии — одной группой сверху, закрытые — по виртуальным столам.
 *
 * Раньше и те и другие лежали вперемешку в группах «стол · монитор», и три
 * работающие сессии терялись среди двух десятков вчерашних слотов.
 *
 * Живые не делятся по столам намеренно: их несколько, ищут их глазами, и
 * «где оно открыто» тут менее важно, чем «что из этого работает прямо сейчас».
 * Закрытые же режутся только по столу — монитор для закрытой сессии не значит
 * почти ничего, потому что мониторы переключаются чаще, чем живут слоты.
 *
 * Внутри группы — выбранный режим сортировки (по умолчанию cost desc).
 */
function groupSessions(sessions, sort = DEFAULT_SORT) {
  const mode = normalizeSort(sort);
  const open = [];
  const groups = new Map();
  for (const s of sessions) {
    if (s.open) { open.push(s); continue; }
    const desktop = s.desktop ?? null;
    const key = `${desktop}`;
    if (!groups.has(key)) {
      groups.set(key, { desktop, monitor: null, label: desktopLabel(desktop), sessions: [] });
    }
    groups.get(key).sessions.push(s);
  }

  const past = [...groups.values()];
  for (const g of past) sortGroupSessions(g.sessions, mode);
  past.sort((a, b) => (a.desktop ?? DESKTOP_UNKNOWN) - (b.desktop ?? DESKTOP_UNKNOWN));

  if (!open.length) return past;
  sortGroupSessions(open, mode);
  return [{ desktop: null, monitor: null, label: `Active sessions - ${open.length}`, sessions: open }, ...past];
}

/**
 * Shape the result of the native claudeWtSessions() call into the
 * claude-wt-sessions event payload the picker UI consumes.
 *
 * Pure: takes the already-fetched `res`, does no I/O of its own.
 */
function buildSessionsPayload(res, sort = DEFAULT_SORT) {
  const mode = normalizeSort(sort);
  return res.ok
    ? { ok: true, groups: groupSessions(labelSessions(res.sessions), mode), sort: mode }
    : { ok: false, reason: res.reason };
}

/**
 * Which way to go for the session the user just picked.
 *
 * The window could have been closed while the list sat on screen, so the handle
 * is checked at the moment of the action rather than kept fresh by polling.
 */
function chooseAction(session, isAlive) {
  if (session.open && session.windowId && isAlive(session.windowId)) return 'focus';
  return 'restore';
}

/**
 * Which virtual desktop (if any) to switch to after picking a session.
 *
 * `winMan.virtualDesktop.GetWindowDesktopNumber` and `GoToDesktopNumber` both
 * use 0-based desktop numbers (see http-server.js/ws-client.js in
 * windows11-manager, which subtract 1 from their 1-based input before
 * calling GoToDesktopNumber). The stored session desktop is 1-based
 * (claude-wt/index.js stores `Number(num) + 1`), but it is never consulted
 * here: the window's *live* desktop — read fresh, right before this call —
 * is authoritative, since the stored value can be stale if the window moved
 * desktops since the last snapshot. So the target is always the live
 * desktop, converted back to the 0-based number GoToDesktopNumber expects;
 * that is a harmless no-op when the app is already showing that desktop, so
 * no comparison against the stored value is needed.
 *
 * `liveDesktop` commonly arrives as a *string*: the native call it comes
 * from, `windows11-manager`'s `GetWindowDesktopNumber`, regex-matches
 * `"desktop number (\d+)"` out of a CLI tool's text output and returns the
 * capture group as-is, never converting it to a number. `Number()` on that
 * string is this function's only real work.
 *
 * Returns the 0-based desktop number to pass to GoToDesktopNumber, or `null`
 * when the live desktop could not be determined (nothing to switch to).
 */
function resolveDesktopSwitch(liveDesktop) {
  if (liveDesktop === undefined || liveDesktop === null) return null;
  return Number(liveDesktop);
}

module.exports = {
  SORT_MODES,
  DEFAULT_SORT,
  normalizeSort,
  cycleSort,
  compareSessions,
  labelSessions,
  groupSessions,
  buildSessionsPayload,
  chooseAction,
  resolveDesktopSwitch,
};
